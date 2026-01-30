import { useEffect, useCallback, useState } from 'react';

/**
 * PWA Hook for OverSeek Companion
 * 
 * Provides:
 * - Online/offline status tracking
 * - Offline action queueing via Service Worker
 * - Service worker update notifications
 * - Background sync registration
 */

interface OfflineAction {
    type: string;
    url: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
}

interface PWAState {
    isOnline: boolean;
    isUpdateAvailable: boolean;
    swVersion: string | null;
    pendingActionsCount: number;
}

export function usePWA() {
    const [state, setState] = useState<PWAState>({
        isOnline: navigator.onLine,
        isUpdateAvailable: false,
        swVersion: null,
        pendingActionsCount: 0
    });

    // Track online/offline status
    useEffect(() => {
        const handleOnline = () => setState(prev => ({ ...prev, isOnline: true }));
        const handleOffline = () => setState(prev => ({ ...prev, isOnline: false }));

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Listen for service worker messages
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const { data } = event;

            if (data?.type === 'SW_UPDATED') {
                setState(prev => ({
                    ...prev,
                    isUpdateAvailable: true,
                    swVersion: data.version
                }));
            }

            if (data?.type === 'SYNC_COMPLETE') {
                // Refresh pending count after sync
                checkPendingActions();
            }

            if (data?.type === 'DASHBOARD_REFRESHED') {
                // Could trigger a state refresh here
                console.log('[PWA] Dashboard data refreshed in background');
            }

            if (data?.type === 'VERSION') {
                setState(prev => ({ ...prev, swVersion: data.version }));
            }
        };

        navigator.serviceWorker?.addEventListener('message', handleMessage);

        // Request version on mount
        navigator.serviceWorker?.ready.then(registration => {
            registration.active?.postMessage({ type: 'GET_VERSION' });
        });

        return () => {
            navigator.serviceWorker?.removeEventListener('message', handleMessage);
        };
    }, []);

    // Check pending actions count
    const checkPendingActions = useCallback(async () => {
        try {
            const request = indexedDB.open('overseek-offline', 1);
            request.onsuccess = () => {
                const db = request.result;
                if (db.objectStoreNames.contains('pending-actions')) {
                    const tx = db.transaction('pending-actions', 'readonly');
                    const store = tx.objectStore('pending-actions');
                    const countReq = store.count();
                    countReq.onsuccess = () => {
                        setState(prev => ({ ...prev, pendingActionsCount: countReq.result }));
                    };
                }
            };
        } catch {
            // IndexedDB not available
        }
    }, []);

    // Queue an action to be synced when online
    const queueOfflineAction = useCallback(async (action: OfflineAction): Promise<boolean> => {
        try {
            const registration = await navigator.serviceWorker?.ready;

            if (registration?.active) {
                registration.active.postMessage({
                    type: 'QUEUE_OFFLINE_ACTION',
                    action
                });

                // Update pending count
                setTimeout(checkPendingActions, 100);
                return true;
            }

            return false;
        } catch (err) {
            console.error('[PWA] Failed to queue offline action:', err);
            return false;
        }
    }, [checkPendingActions]);

    // Force update the service worker
    const updateServiceWorker = useCallback(async () => {
        try {
            const registration = await navigator.serviceWorker?.ready;
            registration?.active?.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
        } catch (err) {
            console.error('[PWA] Failed to update service worker:', err);
        }
    }, []);

    // Register periodic sync (if supported)
    const registerPeriodicSync = useCallback(async (tag: string, minInterval: number) => {
        try {
            const registration = await navigator.serviceWorker?.ready;

            // @ts-expect-error - periodicSync is not in TypeScript types yet
            if (registration?.periodicSync) {
                // @ts-expect-error
                await registration.periodicSync.register(tag, {
                    minInterval
                });
                console.log('[PWA] Periodic sync registered:', tag);
                return true;
            }

            return false;
        } catch (err) {
            console.warn('[PWA] Periodic sync not supported:', err);
            return false;
        }
    }, []);

    // Check pending actions on mount
    useEffect(() => {
        checkPendingActions();
    }, [checkPendingActions]);

    return {
        ...state,
        queueOfflineAction,
        updateServiceWorker,
        registerPeriodicSync,
        checkPendingActions
    };
}

/**
 * Hook to check if running as installed PWA
 */
export function useIsPWA(): boolean {
    const [isPWA, setIsPWA] = useState(false);

    useEffect(() => {
        // Check various indicators of PWA mode
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
        const isFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
        // @ts-expect-error - iOS specific
        const isIOSPWA = window.navigator.standalone === true;

        setIsPWA(isStandalone || isFullscreen || isIOSPWA);
    }, []);

    return isPWA;
}
