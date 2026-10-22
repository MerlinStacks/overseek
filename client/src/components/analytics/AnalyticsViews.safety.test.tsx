import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', currency: 'USD' }, fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
import { AOVTrendView } from './AOVTrendView';
import { CROView } from './CROView';
import { RevenuePage } from '../../pages/analytics/RevenuePage';
const response = (data: unknown) => ({ ok: true, json: async () => data });
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a', currency: 'USD' }; vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('scope-safe truthful analytics views', () => {
    it('uses order-weighted AOV and draws an accessible chart rather than averaging daily means', async () => {
        m.fetch.mockImplementation(async (url: string) => response(url.includes('comparison') ? { current: 19, previous: 0 } : [{ date: '2026-10-02', aov: 100, orders: 1 }, { date: '2026-10-01', aov: 10, orders: 9 }, { date: '2026-10-03', aov: 0, orders: 0 }]));
        render(<AOVTrendView days={30} />); expect(await screen.findByText(/Order-weighted average: \$19\.00/)).toBeInTheDocument(); expect(screen.getByRole('img')).toHaveAccessibleName(/Daily average order value/); expect(screen.getByText(/zero baseline/)).toBeInTheDocument();
    });
    it('keeps successful CRO sections available when another section fails and never invents no-session bounce rates', async () => {
        m.fetch.mockImplementation(async (url: string) => {
            if (url.includes('/source')) throw new Error('Unavailable');
            return response(url.includes('bounce-rate') ? { overallBounceRate: 0, totalSessions: 0 } : [{ device: 'desktop', sessions: 10, conversions: 1, conversionRate: 10 }]);
        });
        render(<CROView dateRange="30d" />); expect(await screen.findByText('desktop')).toBeInTheDocument(); expect(screen.getByText(/Unavailable \(no tracked sessions\)/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: /Retry conversion rate by source/ })).toBeInTheDocument();
    });
    it('hides previous-account revenue immediately and ignores a late callback after scope changes', async () => {
        const data = (amount: number) => ({ totalRevenue: amount, orderCount: 1, aov: amount, byFirstTouch: [], byLastTouch: [], byCountry: [], byDevice: [] });
        let resolve!: (value: unknown) => void;
        m.fetch.mockImplementation((url: string, options: RequestInit) => {
            if (url.includes('/tracking/revenue')) return (options.headers as Record<string, string>)['X-Account-ID'] === 'a' ? new Promise(r => { resolve = r; }) : Promise.resolve(response(data(222)));
            return Promise.resolve(response(url.includes('comparison') ? { current: 0, previous: 0 } : []));
        });
        const view = render(<RevenuePage />); await act(async () => { await Promise.resolve(); }); m.account = { id: 'b', currency: 'USD' }; view.rerender(<RevenuePage />);
        expect(await screen.findAllByText('$222.00')).toHaveLength(2);
        await act(async () => { resolve(response(data(111))); }); expect(screen.queryByText('$111.00')).toBeNull();
    });
    it('shows retry rather than crashing on malformed analytics data', async () => {
        m.fetch.mockResolvedValue(response({ totalRevenue: 'not-a-number' })); render(<RevenuePage />); expect(await screen.findByRole('button', { name: 'Retry revenue' })).toBeInTheDocument();
    });
});
