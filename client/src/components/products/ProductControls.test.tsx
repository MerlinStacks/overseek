import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', currency: 'EUR' }, permission: true, fetch: vi.fn() }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => m.permission }) }));
import { PricingPanel } from './PricingPanel';
import { StockManagementPanel, type StockManagementPanelRef } from './StockManagementPanel';
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => { vi.clearAllMocks(); m.account = { id: 'a', currency: 'EUR' }; m.permission = true; vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('pricing inputs', () => {
    it('preserves explicit zero cost and zero sale price without inventing a margin', () => {
        render(<PricingPanel formData={{ price: '100', salePrice: '0', cogs: '0' }} onChange={vi.fn()} />);
        expect(screen.getByText('Unavailable for a zero selling price')).toBeInTheDocument(); expect(screen.getAllByText(/EUR.*0/).length).toBeGreaterThan(1);
        expect(screen.getByText(/Based on sale price/)).toHaveTextContent(/0/); expect(screen.getByLabelText('Regular Price')).toHaveValue(100);
    });
    it.each(['', '3junk', 'Infinity', '-1'])('does not fabricate profit for invalid/missing cost %s', cogs => {
        render(<PricingPanel formData={{ price: '100', salePrice: '', cogs }} onChange={vi.fn()} />); expect(screen.getByRole('status')).toHaveTextContent('Missing costs');
    });
    it('hides financial calculations and costs without permission', () => {
        m.permission = false; render(<PricingPanel formData={{ price: '100', salePrice: '', cogs: '5' }} onChange={vi.fn()} />);
        expect(screen.queryByText('Profit Margin')).toBeNull(); expect(screen.queryByLabelText('Cost of Goods (COGS)')).toBeNull();
    });
});
const stock = { stockQuantity: 2, isBOMBased: false, manageStock: true, isVariable: false };
describe('stock account isolation and saves', () => {
    it('does not expose editing before a valid stock read', async () => {
        m.fetch.mockResolvedValue(response({ invalid: true })); const ref = createRef<StockManagementPanelRef>(); render(<StockManagementPanel ref={ref} productWooId={1} />);
        await expect(ref.current!.save()).resolves.toBe(false); await screen.findByRole('alert'); expect(screen.queryByRole('spinbutton')).toBeNull();
    });
    it('rejects fractional quantities and guards duplicate saves', async () => {
        m.fetch.mockResolvedValueOnce(response(stock)); const callback = vi.fn(); render(<StockManagementPanel productWooId={1} onStockChange={callback} />);
        const input = await screen.findByRole('spinbutton'); fireEvent.change(input, { target: { value: '2.5' } }); fireEvent.click(screen.getByRole('button', { name: 'Update Stock' }));
        expect(screen.getByRole('alert')).toHaveTextContent('whole stock'); expect(m.fetch).toHaveBeenCalledOnce();
        fireEvent.change(input, { target: { value: '0' } }); let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const button = screen.getByRole('button', { name: 'Update Stock' }); fireEvent.click(button); fireEvent.click(button); expect(m.fetch).toHaveBeenCalledTimes(2);
        await act(async () => { resolve(response({ success: true, stockQuantity: 0 })); }); expect(callback).toHaveBeenCalledExactlyOnceWith(0, undefined);
    });
    it('aborts an old-account save, clears its draft, and suppresses late callbacks', async () => {
        m.fetch.mockResolvedValueOnce(response(stock)); const callback = vi.fn(); const view = render(<StockManagementPanel productWooId={1} onStockChange={callback} />);
        fireEvent.change(await screen.findByRole('spinbutton'), { target: { value: '7' } }); let resolve!: (value: unknown) => void;
        m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(screen.getByRole('button', { name: 'Update Stock' })); const signal = m.fetch.mock.calls[1][1].signal;
        m.account = { id: 'b', currency: 'AUD' }; m.fetch.mockResolvedValue(response({ ...stock, stockQuantity: 11 })); view.rerender(<StockManagementPanel productWooId={1} onStockChange={callback} />);
        expect(await screen.findByRole('spinbutton')).toHaveValue(11); await act(async () => { resolve(response({ success: true, stockQuantity: 7 })); });
        expect(signal.aborted).toBe(true); expect(callback).not.toHaveBeenCalled(); expect(screen.getByRole('spinbutton')).toHaveValue(11);
    });
    it('flushes changed variants serially and retains successful rows if a later row fails', async () => {
        m.fetch.mockResolvedValueOnce(response({ ...stock, isVariable: true, variants: [{ wooId: 11, attributes: 'Red', stockQuantity: 1, manageStock: true }, { wooId: 12, attributes: 'Blue', stockQuantity: 2, manageStock: true }] }));
        const ref = createRef<StockManagementPanelRef>(); render(<StockManagementPanel ref={ref} productWooId={1} />);
        fireEvent.change(await screen.findByRole('spinbutton', { name: 'Red stock' }), { target: { value: '5' } }); fireEvent.change(screen.getByRole('spinbutton', { name: 'Blue stock' }), { target: { value: '6' } });
        m.fetch.mockResolvedValueOnce(response({ success: true, stockQuantity: 5 })).mockResolvedValueOnce({ ok: false });
        await act(async () => { await expect(ref.current!.save()).resolves.toBe(false); }); expect(m.fetch.mock.calls[1][0]).toContain('/variants/11/stock'); expect(m.fetch.mock.calls[2][0]).toContain('/variants/12/stock');
        expect(screen.getByRole('alert')).toHaveTextContent('Saved rows are retained');
        m.fetch.mockResolvedValueOnce(response({ success: true, stockQuantity: 6 })); await act(async () => { await expect(ref.current!.save()).resolves.toBe(true); }); expect(m.fetch).toHaveBeenCalledTimes(4);
    });
    it('keeps calculated BOM stock read-only and treats flushing it as a no-op', async () => {
        m.fetch.mockResolvedValue(response({ ...stock, isBOMBased: true })); const ref = createRef<StockManagementPanelRef>(); render(<StockManagementPanel ref={ref} productWooId={1} />);
        await screen.findByText(/Stock is calculated/); expect(screen.queryByRole('spinbutton')).toBeNull(); await expect(ref.current!.save()).resolves.toBe(true); expect(m.fetch).toHaveBeenCalledOnce();
    });
    it('ignores an aborted read even when the fetch mock resolves late', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<StockManagementPanel productWooId={1} />);
        await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        m.fetch.mockResolvedValue(response({ ...stock, stockQuantity: 8 })); view.rerender(<StockManagementPanel productWooId={2} />); await screen.findByRole('spinbutton');
        await act(async () => { resolve(response(stock)); }); expect(signal.aborted).toBe(true); expect(screen.getByRole('spinbutton')).toHaveValue(8);
    });
});
