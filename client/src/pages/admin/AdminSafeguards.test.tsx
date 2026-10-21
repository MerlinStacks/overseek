import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ token: 'token', user: { id: 'admin', isSuperAdmin: true }, request: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: m.token, user: m.user }) }));
vi.mock('../../services/api', () => ({ api: { request: m.request } }));
import { AdminDashboard } from './AdminDashboard';
import { AdminDiagnosticsPage } from './AdminDiagnosticsPage';
const stats = { totalAccounts: 1, totalUsers: 2, activeSyncs: 0, failedSyncs24h: 3 };
const health = { status: 'healthy', timestamp: 'today', version: { app: '1', node: '22', uptimeFormatted: '1h', uptime: 3600 }, services: {}, queues: {}, webhooks: { failed24h: 0, processed24h: 0, received24h: 0 }, sync: { totalAccounts: 1, entityTypes: [] } };
beforeEach(() => { vi.resetAllMocks(); m.token = 'token'; m.user = { id: 'admin', isSuperAdmin: true }; vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('admin dashboard isolation and destructive scope', () => {
    it('does not turn failed statistics into zeros and loads health independently', async () => {
        m.request.mockImplementation(async url => { if (url.endsWith('/stats')) throw new Error('Offline'); return health; }); render(<AdminDashboard />);
        await screen.findByRole('alert'); await waitFor(() => expect(screen.queryByText('Health unavailable')).toBeNull()); expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    });
    it('confirms all-time deletion rather than pretending it is limited to the 24-hour statistic', async () => {
        m.request.mockImplementation(async (url, options) => options.method === 'DELETE' ? { success: true, deleted: 20 } : url.endsWith('/stats') ? stats : health);
        render(<AdminDashboard />); await screen.findByText('3'); fireEvent.click(screen.getByRole('button', { name: 'Clear failed logs (all time)' }));
        await screen.findByText('Cleared 20 failed sync logs (all time).'); expect(confirm).toHaveBeenCalledWith(expect.stringContaining('ALL TIME'));
    });
    it('aborts old admin reads and suppresses late private results', async () => {
        let resolve!: (value: unknown) => void; m.request.mockImplementation(url => url.endsWith('/stats') ? new Promise(r => { resolve = r; }) : Promise.resolve(health)); const view = render(<AdminDashboard />);
        await waitFor(() => expect(m.request).toHaveBeenCalledTimes(2)); const signal = m.request.mock.calls.find(([url]) => url.endsWith('/stats'))![1].signal;
        m.token = ''; view.rerender(<AdminDashboard />); await act(async () => { resolve(stats); }); expect(signal.aborted).toBe(true); expect(screen.queryByText('Total Users')).toBeNull();
    });
});
describe('diagnostic mutation feedback and serialization', () => {
    it('uses complete subscription IDs, prevents concurrent deletes and preserves failed outcomes', async () => {
        const id = 'full-subscription-id'; let resolve!: (value: unknown) => void;
        m.request.mockImplementation((url, options) => options.method === 'DELETE' ? new Promise(r => { resolve = r; }) : Promise.resolve(url.endsWith('/system-health') ? health : { totalSubscriptions: 1, uniqueAccounts: 1, byAccount: { Store: [{ id, userId: 'u', userEmail: 'u@test', userName: null, accountId: 'a', accountName: 'Store', notifyOrders: true, notifyMessages: true, endpointShort: 'push', updatedAt: 'today' }] } }));
        render(<AdminDiagnosticsPage />); fireEvent.click(screen.getByRole('button', { name: 'Load Subscriptions' })); await screen.findByText('u@test');
        const button = screen.getByRole('button', { name: `Delete subscription for u@test (${id})` }); fireEvent.click(button); fireEvent.click(button); expect(m.request.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1);
        await act(async () => { resolve({ success: false }); }); await screen.findByRole('alert'); expect(screen.getByText('u@test')).toBeInTheDocument(); expect(m.request.mock.calls.some(([url]) => url.endsWith(`/${id}`))).toBe(true);
    });
});
