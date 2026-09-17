import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InternalProductsList } from './InternalProductsList';

const account = { id: 'account-1' };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: account }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));

const product = {
    id: 'component-1', accountId: account.id, name: 'Wooden blank', stockQuantity: 5,
    sku: 'BLANK', cogs: 2, supplier: null, bomUsageCount: 2
};
const fetchMock = vi.fn();

async function renderList() {
    render(<InternalProductsList />);
    return screen.findByRole('spinbutton', { name: 'Stock for Wooden blank' });
}

describe('component list inline stock editing', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
            if (options?.method === 'PUT') {
                return { ok: true, json: async () => ({ ...product, ...JSON.parse(options.body as string) }) };
            }
            return { ok: true, json: async () => url.includes('suppliers') ? [] : { items: [product], total: 1 } };
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('adjusts a draft with +/- and saves only stock with account authentication', async () => {
        const input = await renderList();
        fireEvent.click(screen.getByRole('button', { name: 'Increase stock for Wooden blank' }));
        fireEvent.click(screen.getByRole('button', { name: 'Increase stock for Wooden blank' }));
        fireEvent.click(screen.getByRole('button', { name: 'Decrease stock for Wooden blank' }));
        expect(input).toHaveValue(6);
        expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: 'Save stock for Wooden blank' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Save stock for Wooden blank' })).not.toBeInTheDocument());
        expect(input).toHaveValue(6);
        expect(fetchMock).toHaveBeenCalledWith('/api/inventory/internal-products/component-1', {
            method: 'PUT',
            headers: { Authorization: 'Bearer test-token', 'X-Account-ID': account.id, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stockQuantity: 6 })
        });
        expect(screen.getByText('Component stock updated')).toBeInTheDocument();
    });

    it('saves zero with Enter and prevents decrementing below zero', async () => {
        const input = await renderList();
        fireEvent.change(input, { target: { value: '0' } });
        expect(screen.getByRole('button', { name: 'Decrease stock for Wooden blank' })).toBeDisabled();
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(screen.getByText('Component stock updated')).toBeInTheDocument());
        expect(input).toHaveValue(0);
    });

    it.each(['', '-1', '1.5', '2147483648'])('rejects invalid stock %s', async (value) => {
        const input = await renderList();
        fireEvent.change(input, { target: { value } });
        expect(input).toHaveAttribute('aria-invalid', 'true');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
        expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number');
    });

    it('does not save unchanged stock and allows Escape to discard a draft', async () => {
        const input = await renderList();
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.change(input, { target: { value: '20' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input).toHaveValue(5);
        expect(screen.queryByRole('button', { name: 'Save stock for Wooden blank' })).not.toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
    });

    it('retains failed drafts for retry', async () => {
        const input = await renderList();
        fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Stock update failed' }) });
        fireEvent.change(input, { target: { value: '12' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(screen.getByText('Stock update failed')).toBeInTheDocument());
        expect(input).toHaveValue(12);
        expect(input).not.toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Save stock for Wooden blank' }));
        await waitFor(() => expect(screen.getByText('Component stock updated')).toBeInTheDocument());
        expect(input).toHaveValue(12);
    });

    it('disables controls and prevents duplicate saves while saving', async () => {
        const input = await renderList();
        let resolve!: (value: unknown) => void;
        fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
        fireEvent.change(input, { target: { value: '8' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(input).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Increase stock for Wooden blank' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save stock for Wooden blank' })).toBeDisabled();
        expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
        resolve({ ok: true, json: async () => ({ ...product, stockQuantity: 8 }) });
        await waitFor(() => expect(input).not.toBeDisabled());
        expect(input).toHaveValue(8);
    });
});
