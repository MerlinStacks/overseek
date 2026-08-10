import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WholesaleProductPanel, type WholesaleProductPanelRef } from './WholesaleProductPanel';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ useApi: () => ({ isReady: true, token: 'token', accountId: 'account', get: mocks.get, put: mocks.put, post: vi.fn(), patch: vi.fn(), delete: vi.fn() }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error, info: vi.fn(), toast: vi.fn() }) }));

const productResult = {
    product: { id: 'product', wooId: 1, name: 'Mug', sku: 'MUG', imageUrl: null, mainImage: 'https://images.test/mug.jpg', readiness: { eligible: true, published: true, inStock: true, hasSku: true, hasImage: true, hasPriceTiers: true }, profile: null },
    readiness: { eligible: true, published: true, inStock: true, hasSku: true, hasImage: true, hasPriceTiers: true },
    profile: { notesDocument: '', personalisationTypes: [], imageUrl: null, priceTaxBasis: 'EXCLUSIVE', priceTiers: [{ minimumQuantity: 10, unitPrice: '5', isPoa: false }] },
};

describe('WholesaleProductPanel safety', () => {
    beforeEach(() => { vi.clearAllMocks(); });
    const getResult = (url: string) => url.includes('/history') ? { events: [], total: 0, page: 1, limit: 10, totalPages: 0 } : url.endsWith('/defaults') ? { defaults: { priceTaxBasis: 'EXCLUSIVE' } } : productResult;

    it('does not expose or save fallback edits after a failed load and supports retry', async () => {
        mocks.get.mockRejectedValueOnce(new Error('Load failed'));
        render(<WholesaleProductPanel productId="product" canEdit />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Load failed');
        expect(screen.queryByRole('button', { name: /save wholesale settings/i })).not.toBeInTheDocument();
        expect(mocks.put).not.toHaveBeenCalled();

        mocks.get.mockImplementation((url: string) => Promise.resolve(getResult(url)));
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(await screen.findByRole('button', { name: /save wholesale settings/i })).toBeEnabled();
    });

    it('leaves the final tier unchanged when removal confirmation is rejected', async () => {
        mocks.get.mockImplementation((url: string) => Promise.resolve(getResult(url)));
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<WholesaleProductPanel productId="product" canEdit />);
        const remove = await screen.findByRole('button', { name: 'Remove tier 1' });
        fireEvent.click(remove);
        expect(confirm).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Remove tier 1' })).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText(/saving with no tiers/i)).not.toBeInTheDocument());
    });

    it('reports wholesale edits as dirty and saves them through the page ref', async () => {
        mocks.get.mockImplementation((url: string) => Promise.resolve(getResult(url)));
        mocks.put.mockResolvedValue({ profile: { ...productResult.profile, priceTiers: [{ minimumQuantity: 10, unitPrice: '4.0000', isPoa: false, leadTimeDays: null }] } });
        const onDirtyChange = vi.fn();
        const ref = createRef<WholesaleProductPanelRef>();
        render(<WholesaleProductPanel ref={ref} productId="product" canEdit onDirtyChange={onDirtyChange} />);

        const unitPrice = await screen.findByLabelText('Unit price');
        fireEvent.change(unitPrice, { target: { value: '4' } });
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

        await expect(ref.current?.save()).resolves.toBe(true);
        expect(mocks.put).toHaveBeenCalledWith('/api/wholesale-catalog/products/product', expect.objectContaining({
            priceTiers: [expect.objectContaining({ minimumQuantity: 10, unitPrice: '4' })],
        }));
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    });
});
