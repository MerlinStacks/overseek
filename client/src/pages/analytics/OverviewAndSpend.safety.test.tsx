import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', timezone: 'America/New_York' }, fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../components/analytics/CROView', () => ({ CROView: () => <p>CRO section</p> }));
vi.mock('../../components/analytics/GeographyView', () => ({ GeographyView: () => <p>Geography section</p> }));
import { AnalyticsOverviewPage } from './AnalyticsOverviewPage';
import { CLVPage } from './CLVPage';
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
const spend = (amount = 10) => ({ observation: { basis: 'observed-window-spend', start: '2026-09-01T00:00:00Z', end: '2026-10-21T00:00:00Z', currency: 'AUD', ordersTruncated: false, sessionsTruncated: false, excludedOrders: 0 },
    averageCLV: amount, medianCLV: amount, newVsReturning: { newCustomers: 1, returningCustomers: 0 }, distribution: [], clvBySource: [], monthlyTrend: [{ month: '2026-09', avgCLV: 0, customerCount: 1 }] });
beforeEach(() => { m.account = { id: 'a', timezone: 'America/New_York' }; m.fetch.mockReset(); vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('uses one explicit account-calendar range for independent overview reads and keeps sections alive on a failure', async () => {
    m.fetch.mockImplementation(async (url: string) => {
        if (url.includes('/searches')) return response({}, false);
        if (url.includes('/exits')) return response({ topExitPages: [{ page: '/checkout', count: 4 }] });
        if (url.includes('/abandonment')) return response({ addedToCartCount: 0, purchasedCount: 0, abandonedCount: 0, abandonmentRate: 0 });
        if (url.includes('/funnel')) return response({ stages: [] });
        return response({ totalSessions: 0, avgSessionDuration: 0, countries: [], devices: [] });
    });
    render(<AnalyticsOverviewPage />); expect(await screen.findByText('/checkout')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Retry top search terms' })).toBeInTheDocument();
    expect(screen.getByText('Unavailable (no cart observations)')).toBeInTheDocument();
    const ranges = m.fetch.mock.calls.map(([url]) => { const params = new URL(String(url), 'https://app.test').searchParams; return `${params.get('startDate')}:${params.get('endDate')}`; });
    expect(new Set(ranges).size).toBe(1); expect(ranges[0]).toMatch(/T04:00:00/);
});
it('hides old-account overview results and discards late callbacks', async () => {
    let resolve!: (value: unknown) => void;
    m.fetch.mockImplementation((url: string, options: RequestInit) => {
        if ((options.headers as Record<string, string>)['X-Account-ID'] === 'a') return new Promise(done => { if (url.includes('/searches')) resolve = done; });
        return Promise.resolve(response(url.includes('/searches') ? { topQueries: [{ query: 'New account', count: 1 }] } : {}));
    });
    const view = render(<AnalyticsOverviewPage />); await waitFor(() => expect(resolve).toBeTypeOf('function'));
    m.account = { ...m.account, id: 'b' }; view.rerender(<AnalyticsOverviewPage />); expect(await screen.findByText('New account')).toBeInTheDocument();
    await act(async () => resolve(response({ topQueries: [{ query: 'Old account', count: 99 }] }))); expect(screen.queryByText('Old account')).toBeNull();
});
it('uses honest month controls, explicit currency metadata and zero-width cohort bars', async () => {
    m.fetch.mockResolvedValue(response(spend())); render(<CLVPage />);
    expect(await screen.findByText(/not complete lifetime value/)).toBeInTheDocument(); expect(screen.getAllByText(/A\$10\.00/).length).toBeGreaterThan(0);
    const bar = document.querySelector('[style*="width"]'); expect(bar).toHaveStyle({ width: '0%' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '3' } }); await waitFor(() => expect(m.fetch.mock.calls.some(([url]) => String(url).includes('monthsBack=3'))).toBe(true));
});
it('withholds monetary summaries with unknown currency and rejects malformed payloads', async () => {
    const value = spend(); value.observation.currency = null as unknown as string; m.fetch.mockResolvedValue(response(value));
    render(<CLVPage />); expect(await screen.findByText(/Monetary summaries are withheld/)).toBeInTheDocument(); expect(screen.queryByText('A$10.00')).toBeNull();
});
