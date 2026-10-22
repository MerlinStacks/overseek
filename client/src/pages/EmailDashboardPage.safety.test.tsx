import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 't' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
import { EmailDashboardPage } from './EmailDashboardPage';
const result = { days: 30, rangeStart: '2026-10-01T00:00:00Z', rangeEnd: '2026-10-22T00:00:00Z', timezone: 'UTC', currency: null, kpis: { flowRevenue: null, broadcastRevenue: null, flowSends: 2, broadcastSends: 3, totalUnsubscribes: 0, attemptedCount: 0, failedCount: 0, failureRate: null }, trends: [{ date: '2026-10-21', unsubscribes: 0, failureRate: null }], recentUnsubscribes: [], coverage: { trendComplete: true, currentDayPartial: true, revenue: 'Revenue currency unavailable', failureDefinition: 'Message status share, not bounce rate', unsubscribeDefinition: 'New records', unknownStatusRows: 0 } };
beforeEach(() => { m.account = { id: 'a' }; m.fetch.mockReset(); vi.stubGlobal('fetch', m.fetch); m.fetch.mockResolvedValue({ ok: true, json: async () => result }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('uses unavailable monetary/ratio states and renders a true zero-width bar', async () => { const view = render(<MemoryRouter><EmailDashboardPage /></MemoryRouter>); await screen.findByText('Revenue currency unavailable'); expect(screen.queryByText('$0.00')).not.toBeInTheDocument(); expect(view.container.querySelector('[aria-hidden="true"] > div')).toHaveStyle({ width: '0%' }); });
it('does not replace errors with invented zeroes or a successful empty list', async () => { m.fetch.mockResolvedValue({ ok: false }); render(<MemoryRouter><EmailDashboardPage /></MemoryRouter>); expect(await screen.findByRole('alert')).toHaveTextContent('No zero values'); expect(screen.queryByText('No unsubscribe records in this window.')).not.toBeInTheDocument(); });
it('aborts old-period reads and prevents their late results appearing', async () => {
    let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); render(<MemoryRouter><EmailDashboardPage /></MemoryRouter>); await act(async () => {});
    const signal = m.fetch.mock.calls[0][1].signal; m.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...result, days: 7 }) }); fireEvent.click(screen.getByRole('button', { name: '7d' })); await screen.findByText('Revenue currency unavailable'); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ok: true, json: async () => ({ ...result, coverage: { ...result.coverage, revenue: 'Old period data' } }) })); expect(screen.queryByText('Old period data')).not.toBeInTheDocument();
});
