import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', name: 'Store' }, allowed: true, fetch: vi.fn(), refresh: vi.fn(), toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { id: 'u' } }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account, refreshAccounts: m.refresh }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => m.toast }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => m.allowed }) }));
vi.mock('../components/common/RichTextEditor', () => ({ RichTextEditor: () => <div>Footer editor</div> }));
import { EmailSettingsPage } from './EmailSettingsPage';
const settings = { bounceTrackingEnabled: false, maxSendPerSecond: 1, maxSendPerDay: 6000, version: '2026-10-01T00:00:00.000Z' };
const response = (value: unknown) => ({ ok: true, json: async () => value });
it('saves daily limits without echoing database fields and uses the acknowledged version on the next save', async () => {
    const stored = { ...settings, id: 'settings-a', accountId: 'a', createdAt: settings.version, updatedAt: settings.version };
    const nextVersion = '2026-10-02T00:00:00.000Z';
    m.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
        if (options?.method === 'POST') {
            const body = JSON.parse(options.body as string);
            expect(Object.keys(body).sort()).toEqual(Object.keys(settings).sort());
            return response({ success: true, settings: { ...stored, ...body, version: nextVersion } });
        }
        return response(url.endsWith('/lists') ? [] : stored);
    });
    render(<EmailSettingsPage />);
    await screen.findByRole('button', { name: 'Save' });
    fireEvent.change(screen.getByLabelText('Daily Sending Limit'), { target: { value: '12000' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(m.toast.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Daily Sending Limit'), { target: { value: '15000' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(m.toast.success).toHaveBeenCalledTimes(2);
    const writes = m.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(JSON.parse(writes[0][1].body)).toEqual({ ...settings, maxSendPerDay: 12000 });
    expect(JSON.parse(writes[1][1].body)).toEqual({ ...settings, maxSendPerDay: 15000, version: nextVersion });
}, 15000);
beforeEach(() => { vi.clearAllMocks(); m.account = { id: 'a', name: 'Store' }; m.allowed = true; vi.stubGlobal('fetch', m.fetch); m.fetch.mockImplementation(async (url: string) => response(url.endsWith('/lists') ? [] : settings)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each(['Save Footer', 'Save Marketing Defaults'])('preserves the limit draft and version after %s refreshes the same account', async (action) => {
    m.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
        if (options?.method === 'PUT') return response({ success: true });
        if (options?.method === 'POST') return response({ success: true, settings: { ...JSON.parse(options.body as string), version: '2026-10-02T00:00:00.000Z' } });
        return response(url.endsWith('/lists') ? [] : settings);
    });
    const view = render(<EmailSettingsPage />);
    await screen.findByRole('button', { name: 'Save' });
    fireEvent.change(screen.getByLabelText('Daily Sending Limit'), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow new customers/ }));
    m.refresh.mockImplementation(async () => {
        m.account = { ...m.account, name: 'Refreshed store' };
        view.rerender(<EmailSettingsPage />);
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: action })));
    expect(m.refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Daily Sending Limit')).toHaveValue(12000);
    expect(screen.getByRole('checkbox', { name: /Allow new customers/ })).not.toBeChecked();
    expect(m.fetch.mock.calls.filter(([url, options]) => url === '/api/email/settings' && !options?.method)).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    const write = m.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(write![1].body)).toEqual({ ...settings, maxSendPerDay: 12000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
}, 15000);
it('serializes saves with the server version and blocks unacknowledged writes', async () => { render(<EmailSettingsPage />); const button = await screen.findByRole('button', { name: 'Save' }); let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(button); fireEvent.click(button); const writes = m.fetch.mock.calls.filter(([, options]) => options.method === 'POST'); expect(writes).toHaveLength(1); expect(JSON.parse(writes[0][1].body).version).toBe(settings.version); await act(async () => resolve({ ok: false, json: async () => ({}) })); expect(screen.getByRole('alert')).toHaveTextContent('reconcile'); expect(m.toast.success).not.toHaveBeenCalled(); });
it('does not expose editable default limits after a failed read', async () => { m.fetch.mockResolvedValue({ ok: false, json: async () => ({}) }); render(<EmailSettingsPage />); expect(await screen.findByRole('alert')).toHaveTextContent('Settings unavailable'); expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(); });
it('aborts an old account save without toasting or installing its response', async () => { const view = render(<EmailSettingsPage />); await screen.findByRole('button', { name: 'Save' }); let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(screen.getByRole('button', { name: 'Save' })); m.account = { id: 'b', name: 'Other store' }; view.rerender(<EmailSettingsPage />); await act(async () => resolve(response({ success: true, settings: { ...settings, maxSendPerDay: 99 } }))); expect(m.toast.success).not.toHaveBeenCalled(); expect(screen.queryByDisplayValue(99)).not.toBeInTheDocument(); });
