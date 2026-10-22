import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { readBoundedBytes } from '../utils/boundedResponse';

const preferenceSchema = z.object({ notifyNewMessages: z.boolean(), notifyNewOrders: z.boolean(), notifyLowStock: z.boolean(), notifyDailySummary: z.boolean() }).strict();
type PushPreferences = z.infer<typeof preferenceSchema>;
const defaults: PushPreferences = { notifyNewMessages: false, notifyNewOrders: false, notifyLowStock: false, notifyDailySummary: false };
const endpointSchema = z.string().url().max(2000).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; });
function supported() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    return window.isSecureContext !== false && 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator && (!ios || !!standalone);
}
function bytesToBase64(value: ArrayBuffer | null) {
    if (!value || value.byteLength > 1000) throw new Error('Push key unavailable');
    return btoa(String.fromCharCode(...new Uint8Array(value)));
}
function vapidBytes(value: unknown) {
    const key = z.string().regex(/^[A-Za-z0-9_-]{80,100}$/).parse(value);
    const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), char => char.charCodeAt(0));
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('VAPID key unavailable');
    return bytes;
}

/** Passive initialization never repairs, subscribes, unsubscribes or resets prefs.
 * Browser and account outcomes are separate; a partial command is reconciliation-only. */
export function usePushNotifications() {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const key = JSON.stringify([user?.id, token, currentAccount?.id]);
    const scopeRef = useRef(key), pendingRef = useRef(false), uncertainRef = useRef(new Set<string>());
    const [snapshot, setSnapshot] = useState<{ key: string; isSubscribed: boolean; preferences: PushPreferences; loading: boolean; state: string }>({ key: '', isSubscribed: false, preferences: defaults, loading: true, state: 'unavailable' });
    const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => supported() ? Notification.permission : 'unsupported');
    const isSupported = supported();
    useLayoutEffect(() => { scopeRef.current = key; return () => { scopeRef.current = ''; }; }, [key]);
    const ready = !!token && !!user?.id && !!currentAccount;
    const request = useCallback(async (path: string, options: RequestInit = {}) => {
        if (!ready) throw new Error('Push scope unavailable');
        const response = await fetch(`/api/notifications${path}`, { ...options, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId!, 'Content-Type': 'application/json' } });
        if (!response.ok) throw new Error('Push acknowledgement unavailable');
        const data = JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 64000)));
        if (options.method && options.method !== 'GET') z.object({ success: z.literal(true) }).parse(data);
        return data;
    }, [ready, token, accountId]);
    useEffect(() => {
        let active = true; const controller = new AbortController();
        if (!isSupported || !ready) return;
        void (async () => {
            try {
                const registration = await navigator.serviceWorker.getRegistration('/push-sw.js');
                const browser = await registration?.pushManager.getSubscription();
                if (!active || scopeRef.current !== key) return;
                if (!browser) { setSnapshot({ key, isSubscribed: false, preferences: defaults, loading: false, state: 'browser-unsubscribed' }); return; }
                const endpoint = endpointSchema.parse(browser.endpoint);
                const data = z.object({ isSubscribed: z.boolean(), preferences: preferenceSchema.nullish() }).parse(await request(`/push/subscription?endpoint=${encodeURIComponent(endpoint)}`, { signal: controller.signal }));
                if (active && scopeRef.current === key) setSnapshot({ key, isSubscribed: data.isSubscribed, preferences: data.preferences ?? defaults, loading: false, state: data.isSubscribed ? 'observed' : 'browser-server-mismatch' });
            } catch { if (active && scopeRef.current === key) setSnapshot({ key, isSubscribed: false, preferences: defaults, loading: false, state: 'unavailable' }); }
        })();
        return () => { active = false; controller.abort(); };
    }, [key, ready, isSupported, request]);
    const command = async (action: 'subscribe' | 'unsubscribe' | 'preferences', changes?: Partial<PushPreferences>) => {
        if (!ready || !isSupported || pendingRef.current || uncertainRef.current.has(key)) return false;
        const admittedKey = key;
        pendingRef.current = true;
        setSnapshot(previous => ({ ...previous, key, loading: true }));
        let consequential = false;
        try {
            const permissionWork = action === 'subscribe' ? Notification.requestPermission() : null;
            let registration = await navigator.serviceWorker.getRegistration('/push-sw.js');
            if (scopeRef.current !== admittedKey) return false;
            if (action === 'subscribe') {
                const result = await permissionWork!;
                if (scopeRef.current !== admittedKey) return false;
                setPermission(result); if (result !== 'granted') return false;
                registration ??= await navigator.serviceWorker.register('/push-sw.js', { updateViaCache: 'none' });
            }
            if (!registration || scopeRef.current !== admittedKey) return false;
            let browser = await registration.pushManager.getSubscription();
            if (scopeRef.current !== admittedKey) return false;
            if (action === 'subscribe') {
                const data = z.object({ publicKey: z.string() }).parse(await request('/vapid-public-key'));
                const applicationServerKey = vapidBytes(data.publicKey);
                if (scopeRef.current !== admittedKey) return false;
                if (browser?.options.applicationServerKey) {
                    const current = new Uint8Array(browser.options.applicationServerKey);
                    if (current.length !== applicationServerKey.length || current.some((byte, index) => byte !== applicationServerKey[index])) throw new Error('Key mismatch requires explicit browser/server reconciliation, not silent replacement');
                }
                consequential = true;
                browser ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
                if (scopeRef.current !== admittedKey) throw new Error('Scope abandoned after browser mutation');
                const endpoint = endpointSchema.parse(browser.endpoint);
                const observed = z.object({ isSubscribed: z.boolean(), preferences: preferenceSchema.nullish() }).parse(await request(`/push/subscription?endpoint=${encodeURIComponent(endpoint)}`));
                const preferences = observed.preferences ?? defaults;
                await request('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: { endpoint, keys: { p256dh: bytesToBase64(browser.getKey('p256dh')), auth: bytesToBase64(browser.getKey('auth')) } }, preferences }) });
                if (scopeRef.current === admittedKey) setSnapshot({ key, isSubscribed: true, preferences, loading: false, state: 'registration-acknowledged-not-delivery' });
            } else {
                if (!browser) throw new Error('Browser endpoint unavailable; server state requires review');
                const endpoint = endpointSchema.parse(browser.endpoint);
                consequential = true;
                if (action === 'unsubscribe') {
                    await request('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
                    // The browser endpoint is shared across accounts. Remove only
                    // this server registration; never silently revoke other accounts.
                    if (scopeRef.current !== admittedKey) throw new Error('Scope abandoned after account removal');
                    if (scopeRef.current === admittedKey) setSnapshot({ key, isSubscribed: false, preferences: defaults, loading: false, state: 'removal-acknowledged' });
                } else {
                    const preferences = preferenceSchema.parse({ ...(snapshot.key === key ? snapshot.preferences : defaults), ...preferenceSchema.partial().parse(changes) });
                    await request('/push/preferences', { method: 'PATCH', body: JSON.stringify({ endpoint, preferences }) });
                    if (scopeRef.current === admittedKey) setSnapshot({ key, isSubscribed: true, preferences, loading: false, state: 'preferences-acknowledged' });
                }
            }
            return scopeRef.current === admittedKey;
        } catch {
            if (consequential) uncertainRef.current.add(admittedKey);
            if (scopeRef.current === admittedKey) setSnapshot(previous => ({ ...previous, key, isSubscribed: false, loading: false, state: consequential ? 'partial-or-uncertain-reconcile' : 'unavailable' }));
            return false;
        } finally { pendingRef.current = false; if (scopeRef.current === admittedKey) setSnapshot(previous => ({ ...previous, loading: false })); }
    };
    const visible = snapshot.key === key ? snapshot : { isSubscribed: false, preferences: defaults, loading: ready, state: 'unavailable' };
    return { isSupported, isSubscribed: visible.isSubscribed, isLoading: isSupported && ready && visible.loading, preferences: visible.preferences, permissionState: permission, evidenceState: visible.state, subscribe: () => command('subscribe'), unsubscribe: () => command('unsubscribe'), updatePreferences: (prefs: Partial<PushPreferences>) => command('preferences', prefs) };
}
