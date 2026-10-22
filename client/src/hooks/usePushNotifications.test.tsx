import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: 'a' }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'u' } }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: m.account } }) }));
import { usePushNotifications } from './usePushNotifications';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); m.account = 'a'; });
function browserFixture() {
    const unsubscribe = vi.fn(), subscribe = vi.fn(), register = vi.fn();
    const subscription = { endpoint: 'https://push.example.test/synthetic', unsubscribe, options: {}, getKey: () => new ArrayBuffer(16) };
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: vi.fn().mockResolvedValue(registration), register } });
    vi.stubGlobal('PushManager', class {}); vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') });
    return { unsubscribe, subscribe, register, registration };
}
it('mount observes only and never silently repairs or resets stored preferences', async () => {
    const browser = browserFixture(); const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ isSubscribed: false, preferences: null })));
    vi.stubGlobal('fetch', fetch);
    const view = renderHook(() => usePushNotifications()); await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    expect(view.result.current.evidenceState).toBe('browser-server-mismatch'); expect(fetch.mock.calls.every(([, options]) => !options.method)).toBe(true);
    expect(browser.register).not.toHaveBeenCalled(); expect(browser.subscribe).not.toHaveBeenCalled(); expect(browser.unsubscribe).not.toHaveBeenCalled();
});
it('does not report backend refusal as successful removal and never revokes a shared browser endpoint', async () => {
    const browser = browserFixture(); const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ isSubscribed: true, preferences: { notifyNewMessages: true, notifyNewOrders: true, notifyLowStock: false, notifyDailySummary: false } }))).mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    const view = renderHook(() => usePushNotifications()); await waitFor(() => expect(view.result.current.isSubscribed).toBe(true));
    await act(async () => { expect(await view.result.current.unsubscribe()).toBe(false); });
    expect(view.result.current.evidenceState).toBe('partial-or-uncertain-reconcile'); expect(browser.unsubscribe).not.toHaveBeenCalled();
    const calls = fetch.mock.calls.length; await act(async () => { expect(await view.result.current.unsubscribe()).toBe(false); }); expect(fetch).toHaveBeenCalledTimes(calls);
});
