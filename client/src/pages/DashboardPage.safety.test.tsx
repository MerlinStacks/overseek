import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const m = vi.hoisted(() => ({ account: { id: 'a' }, request: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock('../hooks/useMobile', () => ({ useMobile: () => false }));
vi.mock('../services/api', () => ({ api: { request: (...args: unknown[]) => m.request(...args) } }));
vi.mock('react-grid-layout/legacy', () => ({ Responsive: ({ children }: { children: ReactNode }) => <div>{children}</div>, WidthProvider: (component: unknown) => component }));
vi.mock('../components/widgets/WidgetRegistry', () => ({ WidgetRegistry: { 'total-sales': { label: 'Test Sales', defaultW: 4, defaultH: 3 } }, renderWidget: () => <p>Sales widget</p> }));
import { DashboardPage } from './DashboardPage';
const oldVersion = '2026-10-21T00:00:00.000Z';
beforeEach(() => { m.account = { id: 'a' }; m.request.mockReset(); m.request.mockImplementation(async (_url, options) => options.method === 'GET' ? { widgets: [], updatedAt: oldVersion } : { updatedAt: '2026-10-21T00:00:01.000Z' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function add() { fireEvent.click(screen.getByRole('button', { name: 'Add dashboard widget' })); fireEvent.click(screen.getByRole('button', { name: /Test Sales/ })); }
it('includes the acknowledged server version in debounced layout saves', async () => {
    render(<DashboardPage />); fireEvent.click(await screen.findByRole('button', { name: 'Unlock layout editing' })); vi.useFakeTimers(); await add();
    await act(async () => { await vi.advanceTimersByTimeAsync(2001); });
    const post = m.request.mock.calls.find(([, options]) => options.method === 'POST'); expect(JSON.parse(post![1].body)).toMatchObject({ version: oldVersion });
});
it('cancels pending saves when account scope changes', async () => {
    const view = render(<DashboardPage />); fireEvent.click(await screen.findByRole('button', { name: 'Unlock layout editing' })); vi.useFakeTimers(); await add();
    m.account = { id: 'b' }; view.rerender(<DashboardPage />); await act(async () => { await vi.advanceTimersByTimeAsync(2001); });
    expect(m.request.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
});
it('pauses after a conflicted save without discarding local edits', async () => {
    m.request.mockImplementation(async (_url, options) => { if (options.method === 'GET') return { widgets: [], updatedAt: oldVersion }; throw Error('conflict'); });
    render(<DashboardPage />); fireEvent.click(await screen.findByRole('button', { name: 'Unlock layout editing' })); vi.useFakeTimers(); await add();
    await act(async () => { await vi.advanceTimersByTimeAsync(2001); }); expect(screen.getByRole('alert')).toHaveTextContent(/automatic saving is paused/); expect(screen.getByText('Sales widget')).toBeInTheDocument();
});
