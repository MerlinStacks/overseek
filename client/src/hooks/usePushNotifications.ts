import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

interface PushPreferences {
    notifyNewMessages: boolean;
    notifyNewOrders: boolean;
    notifyLowStock: boolean;
    notifyDailySummary: boolean;
}

interface UsePushNotificationsReturn {
    isSupported: boolean;
    isSubscribed: boolean;
    isLoading: boolean;
    preferences: PushPreferences;
    permissionState: NotificationPermission | 'unsupported';
    subscribe: () => Promise<boolean>;
    unsubscribe: () => Promise<boolean>;
    updatePreferences: (prefs: Partial<PushPreferences>) => Promise<boolean>;
}

/**
 * React hook for managing Web Push notification subscriptions.
 * 
 * Handles service worker registration, VAPID subscription, and syncs with backend.
 */
export function usePushNotifications(): UsePushNotificationsReturn {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [isSupported, setIsSupported] = useState(false);
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [preferences, setPreferences] = useState<PushPreferences>({
        notifyNewMessages: true,
        notifyNewOrders: true,
        notifyLowStock: false,
        notifyDailySummary: false
    });
    const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>('default');
    const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
    const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);

    // Check browser support
    useEffect(() => {
        const supported = 'serviceWorker' in navigator && 'PushManager' in window;
        setIsSupported(supported);

        if (!supported) {
            setPermissionState('unsupported');
            setIsLoading(false);
            return;
        }

        setPermissionState(Notification.permission);
    }, []);

    // Register service worker and check subscription status
    useEffect(() => {
        if (!isSupported || !token || !currentAccount) {
            setIsLoading(false);
            return;
        }

        const init = async () => {
            try {
                // Register service worker with cache bypass
                const registration = await navigator.serviceWorker.register('/push-sw.js', {
                    updateViaCache: 'none' // Force fetch SW on each check
                });
                setSwRegistration(registration);
                console.log('[usePushNotifications] Service worker registered');

                // Check for updates periodically and on refresh
                registration.update().catch(err => console.warn('[usePushNotifications] SW update check failed:', err));

                // Listen for SW update messages
                navigator.serviceWorker.addEventListener('message', (event) => {
                    if (event.data?.type === 'SW_UPDATED') {
                        console.log('[usePushNotifications] New SW version available:', event.data.version);
                        // Dispatch custom event for UI to handle
                        window.dispatchEvent(new CustomEvent('pwa-update-available', {
                            detail: { version: event.data.version }
                        }));
                    }
                });

                // Check existing subscription from browser
                const subscription = await registration.pushManager.getSubscription();
                const browserEndpoint = subscription?.endpoint || null;
                console.log('[usePushNotifications] Browser subscription:', browserEndpoint ? 'exists' : 'none');

                if (browserEndpoint) {
                    setCurrentEndpoint(browserEndpoint);
                }

                // Fetch status from backend - pass browser endpoint for device-specific check
                const url = browserEndpoint
                    ? `/api/notifications/push/subscription?endpoint=${encodeURIComponent(browserEndpoint)}`
                    : '/api/notifications/push/subscription';

                const res = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });

                if (res.ok) {
                    const data = await res.json();
                    console.log('[usePushNotifications] Backend status:', data);

                    // If we have a browser subscription, check if backend knows about THIS device
                    if (browserEndpoint) {
                        setIsSubscribed(data.isSubscribed);
                        if (data.preferences) {
                            setPreferences(data.preferences);
                        }
                    } else {
                        // No browser subscription - show as unsubscribed on this device
                        setIsSubscribed(false);
                    }
                } else {
                    console.error('[usePushNotifications] Backend status check failed:', res.status);
                }
            } catch (error) {
                console.error('[usePushNotifications] Init failed:', error);
            } finally {
                setIsLoading(false);
            }
        };

        init();
    }, [isSupported, token, currentAccount]);

    /**
     * Subscribe to push notifications.
     */
    const subscribe = useCallback(async (): Promise<boolean> => {
        if (!isSupported || !swRegistration || !token || !currentAccount) {
            return false;
        }

        setIsLoading(true);

        try {
            // Request notification permission
            const permission = await Notification.requestPermission();
            setPermissionState(permission);

            if (permission !== 'granted') {
                setIsLoading(false);
                return false;
            }

            // Get VAPID public key from backend
            const keyRes = await fetch('/api/notifications/vapid-public-key', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!keyRes.ok) {
                console.error('[usePushNotifications] Failed to get VAPID key');
                setIsLoading(false);
                return false;
            }

            const { publicKey } = await keyRes.json();

            // Subscribe to push manager
            const subscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
            });

            // Send subscription to backend
            const subRes = await fetch('/api/notifications/push/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    subscription: {
                        endpoint: subscription.endpoint,
                        keys: {
                            p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
                            auth: arrayBufferToBase64(subscription.getKey('auth'))
                        }
                    },
                    preferences
                })
            });

            if (subRes.ok) {
                const subData = await subRes.json();
                console.log('[usePushNotifications] Subscription saved:', subData);
                setCurrentEndpoint(subscription.endpoint);
                setIsSubscribed(true);
                setIsLoading(false);
                return true;
            } else {
                const errorData = await subRes.json().catch(() => ({}));
                console.error('[usePushNotifications] Subscribe request failed:', subRes.status, errorData);
            }
        } catch (error) {
            console.error('[usePushNotifications] Subscribe failed:', error);
        }

        setIsLoading(false);
        return false;
    }, [isSupported, swRegistration, token, currentAccount, preferences]);

    /**
     * Unsubscribe from push notifications.
     */
    const unsubscribe = useCallback(async (): Promise<boolean> => {
        if (!swRegistration || !token || !currentEndpoint) {
            return false;
        }

        setIsLoading(true);

        try {
            // Unsubscribe from push manager
            const subscription = await swRegistration.pushManager.getSubscription();
            if (subscription) {
                await subscription.unsubscribe();
            }

            // Remove from backend
            await fetch('/api/notifications/push/subscribe', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ endpoint: currentEndpoint })
            });

            setIsSubscribed(false);
            setCurrentEndpoint(null);
            setIsLoading(false);
            return true;
        } catch (error) {
            console.error('[usePushNotifications] Unsubscribe failed:', error);
        }

        setIsLoading(false);
        return false;
    }, [swRegistration, token, currentEndpoint]);

    /**
     * Update notification preferences.
     */
    const updatePreferences = useCallback(async (newPrefs: Partial<PushPreferences>): Promise<boolean> => {
        if (!token || !currentEndpoint) {
            return false;
        }

        const updatedPrefs = { ...preferences, ...newPrefs };

        try {
            const res = await fetch('/api/notifications/push/preferences', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    endpoint: currentEndpoint,
                    preferences: newPrefs
                })
            });

            if (res.ok) {
                setPreferences(updatedPrefs);
                return true;
            }
        } catch (error) {
            console.error('[usePushNotifications] Update preferences failed:', error);
        }

        return false;
    }, [token, currentEndpoint, preferences]);

    return {
        isSupported,
        isSubscribed,
        isLoading,
        preferences,
        permissionState,
        subscribe,
        unsubscribe,
        updatePreferences
    };
}

// Helper: Convert VAPID public key from base64 to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Helper: Convert ArrayBuffer to base64 string
function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}
