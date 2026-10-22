import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, request: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../services/api', () => ({ api: { request: (...args: unknown[]) => m.request(...args) } }));
vi.mock('../../hooks/useVisibilityPolling', async () => {
    const { useEffect } = await import('react');
    return { useVisibilityPolling: (fn: () => void) => useEffect(() => { fn(); }, [fn]) };
});
import { StatusCenterWidget } from './StatusCenterWidget';
const data = (message: string, time = new Date().toISOString()) => {
    const section = { status: 'healthy', message, lastChecked: time, details: { todayRevenue: 10, responseTimeMs: 25, error: 'secret' } };
    return { overallHealth: 'healthy', lastUpdated: time, sync: section, webhooks: section, storeHealth: section, revenueAlerts: section };
};
afterEach(() => { cleanup(); vi.clearAllMocks(); m.account = { id: 'a' }; });
it('marks stale observations unverified and never invents revenue currency', async () => {
    m.request.mockResolvedValue(data('Observed', new Date(Date.now() - 3600000).toISOString()));
    render(<StatusCenterWidget />); expect(await screen.findByText(/current health is unverified/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Data Sync/ }));
    expect(screen.getByText('10.00 (currency unavailable)')).toBeInTheDocument(); expect(screen.queryByText('secret')).toBeNull();
});
it('ignores late data after account changes', async () => {
    let resolve!: (value: unknown) => void;
    m.request.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(data('New scope'));
    const view = render(<StatusCenterWidget />); m.account = { id: 'b' }; view.rerender(<StatusCenterWidget />);
    expect(await screen.findAllByText('New scope')).toHaveLength(4);
    await act(async () => { resolve(data('Old scope')); }); expect(screen.queryByText('Old scope')).toBeNull();
});
it('handles unknown status values without crashing', async () => {
    m.request.mockResolvedValue({ ...data('Unknown observation'), overallHealth: '__proto__', sync: null });
    render(<StatusCenterWidget />); expect(await screen.findByText(/current health is unverified/)).toBeInTheDocument();
});
