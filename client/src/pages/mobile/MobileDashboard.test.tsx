import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileDashboard } from './MobileDashboard';

const polling = vi.hoisted(() => ({ callback: async () => {}, interval: 0 }));
const account = vi.hoisted(() => ({ id: 'store-1', currency: 'USD' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { ...account } }) }));
vi.mock('../../utils/dateUtils', () => ({ getDateRange: (period: string) => ({ startDate: `${period}-start`, endDate: `${period}-end` }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock('../../hooks/useVisibilityPolling', () => ({ useVisibilityPolling: (callback: () => Promise<void>, interval: number) => {
    polling.callback = callback;
    polling.interval = interval;
} }));
vi.mock('../../utils/logger', () => ({ Logger: { debug: vi.fn(), error: vi.fn() } }));

function Location() {
    return <output data-testid="location">{useLocation().pathname}</output>;
}

async function renderDashboard() {
    let view: ReturnType<typeof render>;
    await act(async () => {
        view = render(<MemoryRouter><MobileDashboard /><Location /></MemoryRouter>);
    });
    await act(async () => polling.callback());
    return view!;
}

beforeEach(() => {
    account.id = 'store-1';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
        ok: true,
        json: async () => url.includes('visitors/log') ? { total: 12, data: [] }
            : url.includes('/sales?') ? { total: 100, count: 5 }
                : url.includes('/search?') ? { orders: [] }
                    : url.includes('unread-count') ? { count: 2 } : { isAnomaly: false }
    })));
});

const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('mobile homepage metrics', () => {
    it('replaces low stock with the total live visitor count and opens the log', async () => {
        await renderDashboard();
        const visitors = screen.getByRole('button', { name: /Live visitors/ });
        expect(within(visitors).getByText('12')).toBeInTheDocument();
        expect(screen.queryByText('Low stock items')).not.toBeInTheDocument();
        expect(fetch).toHaveBeenCalledWith('/api/analytics/visitors/log?live=true&limit=1', {
            headers: { Authorization: 'Bearer token', 'X-Account-ID': 'store-1' }
        });
        fireEvent.click(visitors);
        expect(screen.getByTestId('location')).toHaveTextContent('/m/live-visitors');
    });

    it('removes metric graphs and stops requesting chart and inventory data', async () => {
        await renderDashboard();
        for (const name of [/Orders today/, /Revenue today/]) {
            expect(screen.getByRole('button', { name }).querySelector('svg path[fill^="url("]')).toBeNull();
        }
        const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
        expect(urls.some(url => url.includes('sales-chart') || url.includes('inventory/health'))).toBe(false);
    });

    it('updates the live count on polling and pull-to-refresh', async () => {
        await renderDashboard();
        expect(polling.interval).toBe(30000);
        const original = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation(async (url, options) => String(url).includes('visitors/log')
            ? { ok: true, json: async () => ({ total: 0 }) } as Response
            : original(url, options));
        await act(async () => polling.callback());
        expect(within(screen.getByRole('button', { name: /Live visitors/ })).getByText('0')).toBeInTheDocument();
        const before = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('visitors/log')).length;
        await act(async () => window.dispatchEvent(new Event('mobile-refresh')));
        expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('visitors/log'))).toHaveLength(before + 1);
    });

    it('shows an unavailable count rather than zero when the visitor request fails', async () => {
        await renderDashboard();
        vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
        await act(async () => polling.callback());
        expect(within(screen.getByRole('button', { name: /Live visitors/ })).getByText('—')).toBeInTheDocument();
        expect(screen.getByText('Orders today')).toBeInTheDocument();
    });

    it.each(['http-error', 'network-error', 'zero', 'missing', 'invalid'])('hides comparisons for an unavailable baseline (%s)', async failure => {
        const original = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation(async (url, options) => {
            if (!String(url).includes('yesterday-start')) return original(url, options);
            if (failure === 'network-error') throw new Error('Offline');
            return response(failure === 'zero' ? { total: 0, count: 0 } : failure === 'invalid' ? { total: 'bad', count: null } : {}, failure !== 'http-error');
        });
        const { container } = await renderDashboard();
        expect(screen.getByText('Orders today')).toBeInTheDocument();
        expect(container.querySelector('[title="Compared with yesterday"]')).toBeNull();
    });

    it('shows real comparisons, including an unchanged zero percent', async () => {
        const { container } = await renderDashboard();
        expect(container.querySelectorAll('[title="Compared with yesterday"]')).toHaveLength(2);
        expect(screen.getAllByText('0.0%', { exact: false })).toHaveLength(2);
    });

    it('keeps loaded metrics visible throughout a refresh and then updates them', async () => {
        await renderDashboard();
        let finish!: (value: Response) => void;
        const pending = new Promise<Response>(resolve => { finish = resolve; });
        const original = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation(async (url, options) => String(url).includes('today-start') ? pending : original(url, options));
        await act(async () => window.dispatchEvent(new Event('mobile-refresh')));
        expect(screen.getByText('Updating overview…')).toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: /Orders today/ })).getByText('5')).toBeInTheDocument();
        await act(async () => finish(response({ total: 200, count: 10 })));
        expect(within(screen.getByRole('button', { name: /Orders today/ })).getByText('10')).toBeInTheDocument();
        expect(screen.queryByText('Updating overview…')).not.toBeInTheDocument();
    });

    it('preserves loaded figures and offers retry after a failed refresh', async () => {
        await renderDashboard();
        vi.mocked(fetch).mockResolvedValue(response({}, false));
        await act(async () => window.dispatchEvent(new Event('mobile-refresh')));
        expect(within(screen.getByRole('button', { name: /Orders today/ })).getByText('5')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.getByText(/Could not load dashboard data/)).toBeInTheDocument();
    });

    it('does not let an older refresh overwrite a newer result', async () => {
        await renderDashboard();
        const finish: Array<(value: Response) => void> = [];
        const original = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation(async (url, options) => String(url).includes('today-start')
            ? new Promise<Response>(resolve => { finish.push(resolve); }) : original(url, options));
        await act(async () => window.dispatchEvent(new Event('mobile-refresh')));
        await act(async () => window.dispatchEvent(new Event('mobile-refresh')));
        await act(async () => finish[1](response({ total: 200, count: 10 })));
        await act(async () => finish[0](response({ total: 150, count: 7 })));
        expect(within(screen.getByRole('button', { name: /Orders today/ })).getByText('10')).toBeInTheDocument();
    });

    it('keeps prior sales but hides comparisons if only today’s sales fail to refresh', async () => {
        const { container } = await renderDashboard();
        const original = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation(async (url, options) => String(url).includes('today-start') ? response({}, false) : original(url, options));
        await act(async () => window.dispatchEvent(new Event('mobile-refresh')));
        expect(within(screen.getByRole('button', { name: /Orders today/ })).getByText('5')).toBeInTheDocument();
        expect(container.querySelector('[title="Compared with yesterday"]')).toBeNull();
        expect(screen.getByText(/Some data could not be updated/)).toBeInTheDocument();
    });

    it('shows customer names alongside recent order numbers, with a guest fallback', async () => {
        const original = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation(async (url, options) => String(url).includes('/search?')
            ? response({ orders: [
                { id: 'order-1', orderNumber: '1001', billing: { first_name: 'Jane', last_name: 'Smith' }, total: 10 },
                { id: 'order-2', orderNumber: '1002', total: 20 }
            ] }) : original(url, options));
        await renderDashboard();
        expect(screen.getByRole('button', { name: /Order #1001 Jane Smith/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Order #1002 Guest/ })).toBeInTheDocument();
    });

    it('does not display the previous store’s figures while a new account loads', async () => {
        const view = await renderDashboard();
        vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
        account.id = 'store-2';
        await act(async () => view.rerender(<MemoryRouter><MobileDashboard /><Location /></MemoryRouter>));
        expect(screen.queryByText('Orders today')).not.toBeInTheDocument();
    });
});
