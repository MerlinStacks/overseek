import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, token: 'token', request: vi.fn(), search: vi.fn(), stats: vi.fn(), clear: vi.fn(), polls: new Map<string, () => Promise<void>>(), socket: null as (() => void) | null }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: m.token }) }));
vi.mock('../../services/api', () => ({ api: { request: m.request } }));
vi.mock('../../services/db', () => ({ searchProductsLocal: m.search, getCacheStats: m.stats, clearAccountCache: m.clear }));
vi.mock('../../hooks/useWidgetSocket', () => ({ useWidgetSocket: (_event: string, callback: () => void) => { m.socket = callback; } }));
vi.mock('../../hooks/useVisibilityPolling', async () => {
    const { useEffect } = await import('react');
    return { useVisibilityPolling: (callback: () => Promise<void>, _interval: number, _deps: unknown, channel: string) => {
        m.polls.set(channel, callback); useEffect(() => { void callback(); }, [callback]);
    } };
});
import { OpenInboxWidget } from './OpenInboxWidget';
import { VisitorCountWidget } from './VisitorCountWidget';
import LiveCartsWidget from './LiveCartsWidget';
import { QuickProductsWidget } from './QuickProductsWidget';
import { HotCacheWidget } from './HotCacheWidget';
import { GoldPriceMarginWidget } from './GoldPriceMarginWidget';
import { WidgetLoadingState, WidgetErrorState } from './WidgetState';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
const props = { dateRange: { startDate: '2026-10-01', endDate: '2026-10-21' } };
const stats = { products: 3, orders: 2, customers: 1, lastSync: { products: null, orders: null, customers: null } };
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a' }; m.token = 'token'; m.polls.clear(); m.stats.mockResolvedValue(stats); m.clear.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('polled widget reads', () => {
    it('keeps unknown inbox counts unavailable and preserves a measured zero', async () => {
        m.request.mockResolvedValueOnce({}).mockResolvedValue({ open: 0 });
        render(<MemoryRouter><OpenInboxWidget {...props} /></MemoryRouter>); await screen.findByRole('alert'); expect(screen.queryByText('0')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByText('0'); expect(screen.getByRole('link')).toHaveAttribute('href', '/inbox');
    });
    it('serializes socket invalidations and refetches once after an in-flight read', async () => {
        let resolve!: (value: unknown) => void; m.request.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue({ open: 2 });
        render(<MemoryRouter><OpenInboxWidget {...props} /></MemoryRouter>); await waitFor(() => expect(m.request).toHaveBeenCalledOnce());
        act(() => { m.socket!(); m.socket!(); }); expect(m.request).toHaveBeenCalledOnce();
        await act(async () => { resolve({ open: 1 }); }); await screen.findByText('2'); expect(m.request).toHaveBeenCalledTimes(2);
    });
    it('aborts an old-account request and hides its late result', async () => {
        let resolve!: (value: unknown) => void; m.request.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue({ open: 7 });
        const view = render(<MemoryRouter><OpenInboxWidget {...props} /></MemoryRouter>); await waitFor(() => expect(m.request).toHaveBeenCalledOnce()); const signal = m.request.mock.calls[0][1].signal;
        m.account = { id: 'b' }; view.rerender(<MemoryRouter><OpenInboxWidget {...props} /></MemoryRouter>); await screen.findByText('7');
        await act(async () => { resolve({ open: 99 }); }); expect(signal.aborted).toBe(true); expect(screen.queryByText('99')).toBeNull();
    });
    it('validates visitor metrics independently and labels the live endpoint cap', async () => {
        m.request.mockImplementation(async (url: string) => url.endsWith('/live') ? Array.from({ length: 50 }, (_, id) => ({ id: String(id), visitorId: String(id) })) : { count: 'bad' });
        render(<VisitorCountWidget {...props} />); await screen.findByText('50+'); expect(await screen.findByRole('alert')).toHaveTextContent('24-hour visitors'); expect(screen.queryByText('0 in last 24h')).toBeNull();
    });
    it('shows stale cart feedback rather than silently replacing a failed read with an empty list', async () => {
        m.request.mockResolvedValueOnce([{ id: 'a', visitorId: 'v', cartValue: '0', itemCount: 0, cartItems: [], lastActiveAt: 'bad', email: 'buyer@example.test' }]).mockRejectedValue(new Error('Offline'));
        render(<LiveCartsWidget {...props} />); await screen.findByText('buyer@example.test'); expect(screen.getByText('Date unavailable')).toBeInTheDocument(); expect(screen.queryByText(/USD/)).toBeNull();
        await act(async () => { await m.polls.get('widget:a:/api/tracking/carts')!(); }); expect(screen.getByRole('alert')).toHaveTextContent('last successful'); expect(screen.queryByText('No active carts')).toBeNull(); expect(screen.getByText('buyer@example.test')).toBeInTheDocument();
    });
    it('rejects malformed carts', async () => {
        m.request.mockResolvedValue([{ id: 'a', cartItems: {} }]); render(<LiveCartsWidget {...props} />); await screen.findByRole('alert'); expect(screen.queryByText('No active carts')).toBeNull();
    });
});
describe('local widget scope', () => {
    it('ignores stale query results and clears results immediately when query changes', async () => {
        let resolve!: (value: unknown) => void; m.search.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue([{ id: 'new', name: 'New result', sku: '', accountId: 'a' }]);
        render(<MemoryRouter><QuickProductsWidget {...props} /></MemoryRouter>); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'old' } }); await waitFor(() => expect(m.search).toHaveBeenCalledOnce());
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } }); await screen.findByRole('link', { name: 'New result' });
        await act(async () => { resolve([{ id: 'old', name: 'Private old result', sku: '', accountId: 'a' }]); }); expect(screen.queryByText('Private old result')).toBeNull();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } }); expect(screen.queryByRole('link')).toBeNull();
    });
    it('shows failed local searches with retry', async () => {
        m.search.mockRejectedValueOnce(new Error('DB unavailable')).mockResolvedValue([]); render(<MemoryRouter><QuickProductsWidget {...props} /></MemoryRouter>);
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'mug' } }); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry search' })); await screen.findByText('No cached products match “mug”.');
    });
    it('does not carry a destructive cache confirmation across account changes', async () => {
        const view = render(<HotCacheWidget {...props} />); await screen.findByText(/3 cached/); fireEvent.click(screen.getByRole('button', { name: 'Clear cache' })); expect(screen.getByRole('button', { name: 'Confirm clear cache' })).toBeInTheDocument();
        m.account = { id: 'b' }; view.rerender(<HotCacheWidget {...props} />); await screen.findByText(/3 cached/); fireEvent.click(screen.getByRole('button', { name: 'Clear cache' })); expect(m.clear).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm clear cache' })); await waitFor(() => expect(m.clear).toHaveBeenCalledExactlyOnceWith('b'));
    });
    it('suppresses late local statistics from an old account and exposes clear errors', async () => {
        let resolve!: (value: unknown) => void; m.stats.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(stats); const view = render(<HotCacheWidget {...props} />);
        await waitFor(() => expect(m.stats).toHaveBeenCalledExactlyOnceWith('a'));
        m.account = { id: 'b' }; view.rerender(<HotCacheWidget {...props} />); await screen.findByText(/3 cached/);
        await act(async () => { resolve({ ...stats, products: 999 }); }); expect(screen.queryByText(/999 cached/)).toBeNull();
        m.clear.mockRejectedValue(new Error('DB failure')); fireEvent.click(screen.getByRole('button', { name: 'Clear cache' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm clear cache' })); await screen.findByRole('alert');
    });
});
describe('widget shared states', () => {
    it('uses status/alert semantics, decorative icons and non-submit retries', () => {
        render(<><WidgetLoadingState message="Loading" /><WidgetErrorState message="Error" onRetry={vi.fn()} /></>);
        expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute('aria-hidden', 'true'); expect(screen.getByRole('alert')).toHaveTextContent('Error'); expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });
    it('offers explicit page reload for chunk failures and resets when scope changes', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        function Broken(): never { throw new Error('Failed to fetch dynamically imported module'); }
        try {
            const view = render(<WidgetErrorBoundary widgetKey="test" resetKey="a"><Broken /></WidgetErrorBoundary>); expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
            view.rerender(<WidgetErrorBoundary widgetKey="test" resetKey="b"><p>Recovered</p></WidgetErrorBoundary>); expect(screen.getByText('Recovered')).toBeInTheDocument();
        } finally { consoleError.mockRestore(); }
    });
    it('labels gold margins as sampled and missing inputs as unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ totalCount: 100, productCount: 80, variationCount: 20, sampledCount: 40, unavailableCount: 1, lowestMarginItems: [{ name: 'Ring', margin: 0 }] }) })));
        render(<MemoryRouter><GoldPriceMarginWidget {...props} /></MemoryRouter>); await screen.findByText('Ring'); expect(screen.getByText('0.0%')).toBeInTheDocument(); expect(screen.getByText(/not a store-wide ranking/)).toBeInTheDocument(); expect(screen.getByText(/1 sampled margins unavailable/)).toBeInTheDocument();
    });
});
