import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    account: { id: 'account-1' }, token: 'token',
    subscribe: vi.fn(), unsubscribe: vi.fn(), updatePreferences: vi.fn(), fetch: vi.fn(),
    subscribed: true, supported: true, permission: 'granted',
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: mocks.token }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: () => ({
    isSupported: mocks.supported, isSubscribed: mocks.subscribed, isLoading: false,
    preferences: { notifyNewMessages: true, notifyNewOrders: true }, permissionState: mocks.permission,
    subscribe: mocks.subscribe, unsubscribe: mocks.unsubscribe, updatePreferences: mocks.updatePreferences,
}) }));
import { NotificationSettings } from './NotificationSettings';
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}
beforeEach(() => {
    vi.resetAllMocks(); mocks.account = { id: 'account-1' }; mocks.token = 'token';
    mocks.subscribed = true; mocks.supported = true; mocks.permission = 'granted';
    mocks.subscribe.mockResolvedValue(true); mocks.unsubscribe.mockResolvedValue(true); mocks.updatePreferences.mockResolvedValue(true);
    mocks.fetch.mockResolvedValue(response({ success: true, sent: 1, failed: 0 }));
    vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('notification settings feedback', () => {
    it.each([true, false])('explains unsuccessful subscription changes (subscribed=%s)', subscribed => {
        mocks.subscribed = subscribed;
        mocks.subscribe.mockResolvedValue(false); mocks.unsubscribe.mockResolvedValue(false);
        render(<NotificationSettings />);
        fireEvent.click(screen.getByRole('button', { name: subscribed ? 'Disable push notifications' : 'Enable push notifications' }));
        return waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(subscribed ? 'Could not disable' : 'Could not enable'));
    });
    it('explains thrown errors and failed preference saves without flipping the controlled preference', async () => {
        mocks.updatePreferences.mockRejectedValue(new Error('Offline'));
        render(<NotificationSettings />);
        const messages = screen.getByRole('checkbox', { name: /New Messages/ }); fireEvent.click(messages);
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save notification preferences'));
        expect(messages).toBeChecked();
        expect(mocks.updatePreferences).toHaveBeenCalledWith({ notifyNewMessages: false });
    });
    it('serializes preference writes and blocks other actions while saving', async () => {
        const saved = deferred<boolean>(); mocks.updatePreferences.mockReturnValue(saved.promise);
        render(<NotificationSettings />);
        fireEvent.click(screen.getByRole('checkbox', { name: /New Orders/ }));
        expect(screen.getByRole('checkbox', { name: /New Messages/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Send Test' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Disable push notifications' })).toBeDisabled();
        await act(async () => { saved.resolve(true); });
        expect(screen.getByRole('checkbox', { name: /New Messages/ })).not.toBeDisabled();
    });
    it('reports server acceptance and partial failures without promising device delivery', async () => {
        mocks.fetch.mockResolvedValue(response({ success: true, sent: 2, failed: 1 }));
        render(<NotificationSettings />); fireEvent.click(screen.getByRole('button', { name: 'Send Test' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('accepted for 2 subscription(s). 1 subscription(s) failed.'));
        expect(screen.getByRole('status')).toHaveTextContent('Delivery on this device is not guaranteed');
        expect(mocks.fetch).toHaveBeenCalledWith('/api/notifications/push/test', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'x-account-id': 'account-1' }, signal: expect.any(AbortSignal) }));
    });
    it.each([{ success: true, sent: 0 }, { success: false, error: 'No subscriptions' }, {}])('does not show success for an unusable result: %j', result => {
        mocks.fetch.mockResolvedValue(response(result)); render(<NotificationSettings />);
        fireEvent.click(screen.getByRole('button', { name: 'Send Test' }));
        return waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Failed to send|No subscriptions/));
    });
    it('handles non-JSON server failures with a readable message', async () => {
        mocks.fetch.mockResolvedValue({ ok: false, json: async () => { throw new Error('Invalid JSON'); } });
        render(<NotificationSettings />); fireEvent.click(screen.getByRole('button', { name: 'Send Test' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to send test notification'));
    });
    it('aborts an old test and ignores its response after an account switch', async () => {
        const old = deferred<ReturnType<typeof response>>(); mocks.fetch.mockReturnValueOnce(old.promise);
        const view = render(<NotificationSettings />); fireEvent.click(screen.getByRole('button', { name: 'Send Test' }));
        const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
        mocks.account = { id: 'account-2' }; view.rerender(<NotificationSettings />);
        expect(signal.aborted).toBe(true);
        await act(async () => { old.resolve(response({ success: true, sent: 9, failed: 0 })); });
        expect(screen.getByRole('status')).not.toHaveTextContent('accepted');
        fireEvent.click(screen.getByRole('button', { name: 'Send Test' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('accepted for 1'));
        expect(mocks.fetch.mock.calls[1][1].headers['x-account-id']).toBe('account-2');
    });
    it('ignores an old preference failure after changing accounts', async () => {
        const old = deferred<boolean>(); mocks.updatePreferences.mockReturnValueOnce(old.promise);
        const view = render(<NotificationSettings />); fireEvent.click(screen.getByRole('checkbox', { name: /New Orders/ }));
        mocks.account = { id: 'account-2' }; view.rerender(<NotificationSettings />);
        await act(async () => { old.resolve(false); });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('checkbox', { name: /New Orders/ })).not.toBeDisabled();
    });
    it('clears the previous reset timer before another test and cleans up on unmount', async () => {
        vi.useFakeTimers(); const view = render(<NotificationSettings />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send Test' })); });
        expect(vi.getTimerCount()).toBe(1);
        act(() => vi.advanceTimersByTime(2000));
        const next = deferred<ReturnType<typeof response>>(); mocks.fetch.mockReturnValueOnce(next.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Send Test' }));
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(2000));
        expect(screen.getByRole('button', { name: /Sending/ })).toBeDisabled();
        await act(async () => { next.resolve(response({ success: true, sent: 1, failed: 0 })); });
        expect(vi.getTimerCount()).toBe(1);
        view.unmount(); expect(vi.getTimerCount()).toBe(0);
    });
    it('blocks enabling when permission is denied and shows unsupported browser guidance', () => {
        mocks.subscribed = false; mocks.permission = 'denied';
        const view = render(<NotificationSettings />);
        expect(screen.getByRole('button', { name: 'Enable push notifications' })).toBeDisabled();
        expect(screen.getByText('Notifications Blocked')).toBeInTheDocument();
        mocks.supported = false; view.rerender(<NotificationSettings />);
        expect(screen.getByText('Push Notifications Not Supported')).toBeInTheDocument();
    });
});
