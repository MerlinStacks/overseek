import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductStockMovements } from './ProductStockMovements';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-a' } }) }));

const fetchMock = vi.fn();
const baseMovement = {
    id: 'movement-1', productName: 'Blue mug', sku: 'MUG-BLUE', type: 'ADJUSTMENT',
    quantity: 3, previousStock: 7 as number | null, newStock: 10 as number | null,
    orderId: null as number | null, reference: null as string | null, reason: null as string | null,
    createdAt: '2026-09-23T12:00:00Z',
};
const movement = (overrides: Partial<typeof baseMovement> = {}) => ({ ...baseMovement, ...overrides });
const response = (movements = [movement()], page = 1, totalPages = 1, total = movements.length) => ({
    ok: true, json: async () => ({ movements, page, totalPages, total }),
});

function history(productId = 'product-a') {
    return <MemoryRouter><ProductStockMovements productId={productId} /></MemoryRouter>;
}

function requests() {
    return fetchMock.mock.calls.map(([url]) => Object.fromEntries(new URL(String(url), 'http://localhost').searchParams));
}

beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('ProductStockMovements', () => {
    it.each([
        ['SALE', 'Sale', -2, '-2'],
        ['ADJUSTMENT', 'Adjustment', 3, '+3'],
        ['BOM_SYNC', 'BOM stock sync', 0, '0'],
        ['ORDER_CONSUMPTION', 'Order consumption', -4, '-4'],
        ['ORDER_REVERSAL', 'Order reversal', 4, '+4'],
        ['PO_RECEIPT', 'Purchase order receipt', 8, '+8'],
        ['PO_REVERSAL', 'Purchase order reversal', -8, '-8'],
        ['SYNC', 'Stock sync', 2, '+2'],
        ['CUSTOM_IMPORT', 'CUSTOM IMPORT', -1, '-1'],
    ])('renders %s with its label and signed quantity', async (type, label, quantity, signedQuantity) => {
        fetchMock.mockResolvedValue(response([movement({ type, quantity, reason: 'Stock reconciliation' })]));
        render(history());

        const row = await screen.findByRole('row', { name: /Blue mug/ });
        const cells = within(row).getAllByRole('cell');
        expect(within(cells[1]).getByText('MUG-BLUE')).toBeInTheDocument();
        expect(within(cells[2]).getByText(label)).toBeInTheDocument();
        expect(within(cells[2]).getByText('Stock reconciliation')).toBeInTheDocument();
        expect(cells[3].textContent).toBe(signedQuantity);
        expect(cells[4].textContent).toBe('7');
        expect(cells[5].textContent).toBe('10');
    });

    it.each(['Order #1042', null])('links sales to their order with reference %s', async reference => {
        fetchMock.mockResolvedValue(response([movement({ type: 'SALE', quantity: -1, orderId: 1042, reference })]));
        render(history());

        expect(await screen.findByRole('link', { name: reference || '#1042' })).toHaveAttribute('href', '/orders/1042');
    });

    it('shows missing balances as dashes while preserving zero balances and plain references', async () => {
        fetchMock.mockResolvedValue(response([
            movement({ id: 'missing', productName: 'Missing balances', previousStock: null, newStock: null }),
            movement({ id: 'zero', productName: 'Zero balances', previousStock: 0, newStock: 0, reference: 'Manual count' }),
        ]));
        render(history());

        const missing = within(await screen.findByRole('row', { name: /Missing balances/ })).getAllByRole('cell');
        expect(missing.slice(4).map(cell => cell.textContent)).toEqual(['—', '—', '—']);
        const zero = within(screen.getByRole('row', { name: /Zero balances/ })).getAllByRole('cell');
        expect(zero.slice(4).map(cell => cell.textContent)).toEqual(['0', '0', 'Manual count']);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('shows loading, sends scoped request parameters, and renders empty history', async () => {
        fetchMock.mockResolvedValue(response([]));
        render(history('product / blue'));

        expect(screen.getByRole('status')).toHaveTextContent('Loading stock movements...');
        expect(await screen.findByText('No recorded stock movements for this product yet.')).toBeInTheDocument();
        expect(screen.getByText('0 movements')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
        expect(requests()).toEqual([{ productId: 'product / blue', page: '1', limit: '15' }]);
        expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/inventory\/stock-movements\?/), {
            headers: { Authorization: 'Bearer test-token', 'X-Account-ID': 'account-a' },
            signal: expect.any(AbortSignal),
        });
    });

    it.each(['HTTP error', 'network rejection'])('recovers from %s by retrying the same request', async failure => {
        if (failure === 'HTTP error') fetchMock.mockResolvedValueOnce({ ok: false });
        else fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
        render(history());

        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load stock movements.');
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(await screen.findByRole('row', { name: /Blue mug/ })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(requests()).toEqual(Array(2).fill({ productId: 'product-a', page: '1', limit: '15' }));
    });

    it('paginates forward and back with disabled boundary buttons and replaces rows', async () => {
        fetchMock.mockImplementation(async (input: string) => {
            const page = Number(new URL(input, 'http://localhost').searchParams.get('page'));
            return response([movement({ productName: `Page ${page} mug` })], page, 2, 16);
        });
        render(history());

        await screen.findByText('Page 1 of 2');
        expect(screen.getByText('16 movements')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

        await screen.findByText('Page 2 of 2');
        expect(screen.getByText('Page 2 mug')).toBeInTheDocument();
        expect(screen.queryByText('Page 1 mug')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));

        await screen.findByText('Page 1 of 2');
        expect(screen.getByText('Page 1 mug')).toBeInTheDocument();
        expect(screen.queryByText('Page 2 mug')).not.toBeInTheDocument();
        expect(requests()).toEqual([1, 2, 1].map(page => ({ productId: 'product-a', page: String(page), limit: '15' })));
    });

    it('resets to page one on product change and ignores the aborted previous product response', async () => {
        let resolveOld!: (value: ReturnType<typeof response>) => void;
        fetchMock.mockResolvedValueOnce(response([movement()], 1, 2, 16))
            .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
            .mockResolvedValueOnce(response([movement({ productName: 'New product' })], 1, 2, 20));
        const { rerender } = render(history());
        await screen.findByText('Page 1 of 2');
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        const oldSignal = fetchMock.mock.calls[1][1].signal as AbortSignal;
        expect(screen.getByRole('status')).toBeInTheDocument();

        rerender(history('product-b'));

        expect(oldSignal.aborted).toBe(true);
        await screen.findByText('New product');
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
        expect(requests()).toEqual([
            { productId: 'product-a', page: '1', limit: '15' },
            { productId: 'product-a', page: '2', limit: '15' },
            { productId: 'product-b', page: '1', limit: '15' },
        ]);

        await act(async () => resolveOld(response([movement({ productName: 'Stale product' })], 2, 2, 16)));
        expect(screen.queryByText('Stale product')).not.toBeInTheDocument();
        expect(screen.getByText('New product')).toBeInTheDocument();
        expect(screen.getByText('20 movements')).toBeInTheDocument();
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    });
});
