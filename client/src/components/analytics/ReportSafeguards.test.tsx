import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', currency: 'EUR' }, fetch: vi.fn() }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
import { ProfitabilityReport } from './ProfitabilityReport';
import { StockVelocityReport } from './StockVelocityReport';
const report = { summary: { revenue: 30, cost: 10, profit: 20, margin: 66 }, breakdown: [{ orderId: 'order', orderNumber: '123', productId: 1, variationId: 0, date: 'invalid', name: 'Product', sku: '', quantity: 1, revenue: 30, cogsUnit: 10, cost: 10, profit: 20, margin: 66 }] };
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a', currency: 'EUR' }; vi.stubGlobal('fetch', m.fetch); m.fetch.mockResolvedValue({ ok: true, json: async () => report }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('analytics report safeguards', () => {
    it('uses explicit account currency, safe dates and keyboard-accessible sorting', async () => {
        render(<ProfitabilityReport startDate="2026-01-01" endDate="2026-01-31" />); await screen.findByRole('rowheader', { name: /Product/ });
        expect(screen.getAllByText(/EUR/).length).toBeGreaterThan(2); expect(screen.getByText('Date unavailable')).toBeInTheDocument();
        const button = screen.getByRole('button', { name: /Date/ }); button.focus(); fireEvent.click(button); expect(button.closest('th')).toHaveAttribute('aria-sort', 'ascending'); expect(button).toHaveFocus();
    });
    it('recovers from failed reads instead of retaining an old error', async () => {
        m.fetch.mockResolvedValueOnce({ ok: false }); render(<ProfitabilityReport startDate="start" endDate="end" />); await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Retry profitability' })); await screen.findByRole('rowheader', { name: /Product/ }); expect(screen.queryByRole('alert')).toBeNull();
    });
    it('aborts and ignores an older account response', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = render(<ProfitabilityReport startDate="start" endDate="end" />); await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        m.account = { id: 'b', currency: 'AUD' }; m.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...report, breakdown: [] }) }); view.rerender(<ProfitabilityReport startDate="start" endDate="end" />); await screen.findByText('No sales found in this period.');
        await act(async () => { resolve({ ok: true, json: async () => report }); }); expect(signal.aborted).toBe(true); expect(screen.queryByText('Product', { selector: 'th[scope="row"]' })).toBeNull();
    });
    it('does not misrepresent absent demand as a long measured runway', async () => {
        const row = { sku: '', image: null, stock: 1, soldLast30d: 1, dailyVelocity: 0.03, daysRemaining: 999 };
        m.fetch.mockResolvedValue({ ok: true, json: async () => [{ ...row, id: 'a', name: 'No demand', soldLast30d: 0 }, { ...row, id: 'b', name: 'Measured' }, { ...row, id: 'c', name: 'Empty', stock: 0 }] });
        render(<StockVelocityReport />); await screen.findByText('No recent sales'); expect(screen.getByText('999 Days')).toBeInTheDocument(); expect(screen.getByText('Out of stock')).toBeInTheDocument(); expect(screen.queryByText('> 1 Year')).toBeNull();
    });
    it('rejects malformed response data with an actionable retry', async () => {
        m.fetch.mockResolvedValue({ ok: true, json: async () => ({ broken: true }) }); render(<StockVelocityReport />); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Retry stock velocity' })).toBeInTheDocument();
    });
});
