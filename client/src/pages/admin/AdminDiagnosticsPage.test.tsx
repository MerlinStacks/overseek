import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, toggle: vi.fn(), remove: vi.fn(), select: vi.fn() }));
vi.mock('./useDiagnostics', () => ({ useDiagnostics: () => mocks.state }));
import { AdminDiagnosticsPage } from './AdminDiagnosticsPage';
beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = {
        loading: false, accounts: [{ id: 'a', name: 'Account' }], selectedAccountId: '', setSelectedAccountId: mocks.select,
        testType: 'order', setTestType: vi.fn(), expandedAccounts: new Set(['Account']), toggleAccount: mocks.toggle,
        subscriptions: { totalSubscriptions: 1, uniqueAccounts: 1, byAccount: { Account: [{ id: 'sub', userEmail: 'owner@test.com', userId: 'user', notifyOrders: true }] } },
        systemHealth: { status: 'degraded', version: { app: '1', node: '22', uptimeFormatted: '1h' }, services: { redis: { status: 'unhealthy' } }, queues: { sync: { waiting: 1, active: 2, failed: 3 } }, sync: { entityTypes: [] }, webhooks: { processed24h: 1, failed24h: 0 } },
        fetchSystemHealth: vi.fn(), fetchSubscriptions: vi.fn(), fetchAccounts: vi.fn(), sendTestPush: vi.fn(), deleteSubscription: mocks.remove, deleteAllSubscriptions: vi.fn()
    };
});
afterEach(cleanup);
describe('admin diagnostics accessibility', () => {
    it('associates selectors with labels and exposes expansion state', () => {
        render(<AdminDiagnosticsPage />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Select Account' }), { target: { value: 'a' } }); expect(mocks.select).toHaveBeenCalledWith('a');
        expect(screen.getByRole('combobox', { name: 'Notification Type' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Account 1 subscription/ })).toHaveAttribute('aria-expanded', 'true');
    });
    it('communicates service and queue statuses without relying on colors or symbols', () => {
        render(<AdminDiagnosticsPage />); expect(screen.getByText('unhealthy')).toBeInTheDocument();
        expect(screen.getByText('Waiting: 1')).toBeInTheDocument(); expect(screen.getByText('Active: 2')).toBeInTheDocument();
    });
    it('names destructive controls and disables them during pending work', () => {
        mocks.state.loading = true; mocks.state.message = { type: 'error', text: 'Failed request' };
        render(<AdminDiagnosticsPage />);
        expect(screen.getByRole('button', { name: 'Delete subscription for owner@test.com (sub)' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('Failed request');
    });
});
