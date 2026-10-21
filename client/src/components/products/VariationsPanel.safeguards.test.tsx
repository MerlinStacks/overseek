import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', currency: 'EUR' }, token: 'token' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: m.token }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => false }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => false }));
vi.mock('./VariantExpandedDetails', () => ({ VariantExpandedDetails: () => null }));
import { VariationsPanel } from './VariationsPanel';
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const props = { product: { id: 'parent', wooId: 10, type: 'variable' }, variants: [{ id: 1, sku: 'SKU', price: '1', attributes: [], manageStock: true, stockQuantity: 2 }, { id: 2, sku: 'SKU2', price: '2', attributes: [], manageStock: true, stockQuantity: 2 }] };
beforeEach(() => { m.account = { id: 'a', currency: 'EUR' }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('variant stock integration', () => {
    it('never submits a fractional draft and serializes integer saves with sibling locks', async () => {
        let resolve!: (value: unknown) => void; const fetch = vi.fn((_url: string, options?: RequestInit) => options?.method === 'PUT' ? new Promise(r => { resolve = r; }) : Promise.resolve(response({ items: [] }))); vi.stubGlobal('fetch', fetch); const update = vi.fn();
        render(<VariationsPanel {...props} onUpdate={update} />); const stock = await screen.findByRole('textbox', { name: 'Stock for variant 1' });
        fireEvent.change(stock, { target: { value: '3.9' } }); expect(screen.getByRole('button', { name: 'Save stock for variant 1' })).toBeDisabled();
        fireEvent.change(stock, { target: { value: '3' } }); fireEvent.click(screen.getByRole('button', { name: 'Save stock for variant 1' })); fireEvent.click(screen.getByRole('button', { name: 'Save stock for variant 1' }));
        expect(screen.getByRole('textbox', { name: 'SKU for variant 2' })).toBeDisabled(); expect(screen.getByRole('textbox', { name: 'Stock for variant 1' })).toBeDisabled(); expect(fetch.mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(1);
        await act(async () => { resolve(response({ success: true, variantWooId: 1, stockQuantity: 3 })); }); await waitFor(() => expect(update).toHaveBeenCalledWith([{ ...props.variants[0], stockQuantity: 3 }, props.variants[1]]));
    });
    it('does not permit manual stock changes when BOM existence is unknown', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, false))); render(<VariationsPanel {...props} />); await screen.findByRole('alert'); expect(screen.queryByRole('textbox', { name: 'Stock for variant 1' })).toBeNull(); expect(screen.getByRole('button', { name: 'Retry BOM checks' })).toBeInTheDocument();
    });
    it('ignores late saves when switching accounts', async () => {
        let resolve!: (value: unknown) => void; const fetch = vi.fn((_url: string, options?: RequestInit) => options?.method === 'PUT' ? new Promise(r => { resolve = r; }) : Promise.resolve(response({ items: [] }))); vi.stubGlobal('fetch', fetch); const update = vi.fn(); const view = render(<VariationsPanel {...props} onUpdate={update} />);
        const stock = await screen.findByRole('textbox', { name: 'Stock for variant 1' }); fireEvent.change(stock, { target: { value: '3' } }); fireEvent.click(screen.getByRole('button', { name: 'Save stock for variant 1' }));
        const signal = fetch.mock.calls.find(call => call[1]?.method === 'PUT')![1]!.signal!;
        m.account = { id: 'b', currency: 'EUR' }; view.rerender(<VariationsPanel {...props} onUpdate={update} />); await act(async () => { resolve(response({ success: true, variantWooId: 1, stockQuantity: 3 })); }); expect(signal.aborted).toBe(true); expect(update).not.toHaveBeenCalled(); expect(await screen.findByRole('textbox', { name: 'Stock for variant 1' })).toHaveValue('2');
    });
});
