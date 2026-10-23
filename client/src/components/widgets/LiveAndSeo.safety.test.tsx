import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, request: vi.fn(), connected: true, queries: [] as { query: string; clicks: number; impressions: number; position: number }[], movers: [] as unknown[], analyticsError: null as Error | null }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../services/api', () => ({ api: { request: (...args: unknown[]) => m.request(...args) } }));
vi.mock('../../hooks/useVisibilityPolling', async () => { const { useEffect } = await import('react'); return { useVisibilityPolling: (fn: () => void) => useEffect(() => { fn(); }, [fn]) }; });
vi.mock('../../hooks/useSeoKeywords', () => ({
    useSearchConsoleStatus: () => ({ data: { connected: m.connected }, isLoading: false }),
    useSearchAnalytics: () => ({ data: { queries: m.queries }, isLoading: false, error: m.analyticsError, refetch: vi.fn() }),
    useKeywordMovers: () => ({ data: { movers: m.movers }, isLoading: false }),
}));
import { LiveAnalyticsWidget } from './LiveAnalyticsWidget';
import { SeoKeywordsWidget } from './SeoKeywordsWidget';
beforeEach(() => { m.account = { id: 'a' }; m.request.mockReset(); m.queries = []; m.movers = []; m.analyticsError = null; });
afterEach(cleanup);
it('groups observed cart currencies without invented USD and counts prototype-like countries safely', async () => {
    m.request.mockResolvedValue([{ country: 'constructor', lastActiveAt: new Date().toISOString(), cartValue: '10', currency: 'AUD' }, { country: 'constructor', lastActiveAt: new Date().toISOString(), cartValue: '99' }]);
    render(<MemoryRouter><LiveAnalyticsWidget /></MemoryRouter>); expect(await screen.findByText('A$10.00')).toBeInTheDocument();
    expect(screen.getByText('constructor: 2')).toBeInTheDocument(); expect(screen.getByText(/excluded from totals/)).toBeInTheDocument(); expect(screen.queryByText('$109.00')).toBeNull();
});
it('discards obsolete live responses after a scope change', async () => {
    let resolve!: (value: unknown) => void; m.request.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue([]);
    const view = render(<MemoryRouter><LiveAnalyticsWidget /></MemoryRouter>); m.account = { id: 'b' }; view.rerender(<MemoryRouter><LiveAnalyticsWidget /></MemoryRouter>);
    expect(await screen.findByLabelText('Returned session count')).toHaveTextContent('0'); await act(async () => resolve([{ country: 'Old', lastActiveAt: new Date().toISOString(), cartValue: 0 }])); expect(screen.queryByText('Old: 1')).toBeNull();
});
it('shows live errors instead of fabricating zero activity', async () => {
    m.request.mockRejectedValue(Error('offline')); render(<MemoryRouter><LiveAnalyticsWidget /></MemoryRouter>);
    expect(await screen.findByText('Live observations unavailable.')).toBeInTheDocument(); expect(screen.queryByText('0')).toBeNull();
});
it('keeps the live widget layout bounded and its styled refresh action working', async () => {
    m.request.mockResolvedValue([{ country: 'AU', lastActiveAt: new Date().toISOString(), cartValue: '12', currency: 'AUD' }]);
    render(<MemoryRouter><LiveAnalyticsWidget className="dashboard-widget" /></MemoryRouter>);
    expect(await screen.findByText('A$12.00')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live analytics' })).toHaveClass('flex', 'h-full', 'min-h-0', 'dashboard-widget');
    expect(screen.getByText('Top Locations').parentElement?.querySelector('ul')).toHaveClass('flex-wrap');
    const refresh = screen.getByRole('button', { name: 'Refresh observations' });
    expect(refresh).toHaveClass('rounded-md');
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    await waitFor(() => expect(m.request).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'View Real-time Report' })).toHaveClass('text-[var(--brand-text)]');
});
it('impression-weights SEO position and labels neutral movement and the actual comparison', () => {
    m.queries = [{ query: 'one', clicks: 1, impressions: 1, position: 1 }, { query: 'two', clicks: 1, impressions: 99, position: 11 }];
    m.movers = [{ query: 'Steady', positionChange: 0, currentPosition: 5, previousPosition: 5, previousImpressions: 100, currentImpressions: 100 }];
    render(<MemoryRouter><SeoKeywordsWidget /></MemoryRouter>); expect(screen.getByText('10.9')).toBeInTheDocument(); expect(screen.getByText(/Unchanged 0.0/)).toBeInTheDocument(); expect(screen.getByText(/Last 7 days vs preceding 7 days/)).toBeInTheDocument();
});
it('does not disguise SEO query errors as empty data', () => {
    m.analyticsError = Error('offline'); render(<MemoryRouter><SeoKeywordsWidget /></MemoryRouter>); expect(screen.getByRole('button', { name: 'Retry queries' })).toBeInTheDocument(); expect(screen.queryByText(/No query rows returned/)).toBeNull();
});
