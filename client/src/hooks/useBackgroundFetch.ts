import { useCallback, useEffect, useState } from 'react';
import { Logger } from '../utils/logger';

/**
 * Background Fetch status
 */
type BackgroundFetchStatus = 'pending' | 'success' | 'fail' | 'aborted';

interface BackgroundFetchProgress {
    id: string;
    downloaded: number;
    total: number;
    status: BackgroundFetchStatus;
}

/**
 * Hook for Background Fetch API
 *
 * Enables large file downloads/uploads that survive app close.
 * Falls back to regular fetch for unsupported browsers.
 *
 * @example
 * ```tsx
 * const { startBackgroundFetch, isSupported } = useBackgroundFetch();
 *
 * // Download large file in background
 * const result = await startBackgroundFetch(
 *   'video-export',
 *   ['/api/exports/video/123'],
 *   { title: 'Exporting video...', icons: [{ src: '/icons/icon-96.png' }] }
 * );
 * ```
 */
export function useBackgroundFetch() {
    const [isSupported] = useState(() => {
        if (typeof navigator === 'undefined') return false;
        return 'serviceWorker' in navigator;
    });

    const [activeFetches, setActiveFetches] = useState<Map<string, BackgroundFetchProgress>>(new Map());

    /**
     * Starts a background fetch operation.
     * Falls back to regular fetch on unsupported browsers.
     */
    const startBackgroundFetch = useCallback(async (
        id: string,
        requests: (string | Request)[],
        options?: {
            title?: string;
            icons?: Array<{ src: string; sizes?: string; type?: string }>;
            downloadTotal?: number;
        }
    ): Promise<Response[] | null> => {
        // Check for Background Fetch support
        const registration = await navigator.serviceWorker?.ready;

        // @ts-expect-error - backgroundFetch not in TypeScript types
        if (!registration?.backgroundFetch) {
            Logger.debug('[BackgroundFetch] Not supported, falling back to regular fetch');
            // Fallback to regular fetch
            try {
                const responses = await Promise.all(
                    requests.map(req => fetch(req))
                );
                return responses;
            } catch (err) {
                Logger.error('[BackgroundFetch] Fallback fetch failed:', { error: err });
                return null;
            }
        }

        try {
            // @ts-expect-error - backgroundFetch not in TypeScript types
            const bgFetch = await registration.backgroundFetch.fetch(id, requests, {
                title: options?.title || 'Downloading...',
                icons: options?.icons || [],
                downloadTotal: options?.downloadTotal
            });

            // Track progress
            setActiveFetches(prev => {
                const next = new Map(prev);
                next.set(id, {
                    id,
                    downloaded: 0,
                    total: options?.downloadTotal || 0,
                    status: 'pending'
                });
                return next;
            });

            // Listen for progress
            bgFetch.addEventListener('progress', () => {
                setActiveFetches(prev => {
                    const next = new Map(prev);
                    next.set(id, {
                        id,
                        downloaded: bgFetch.downloaded,
                        total: bgFetch.downloadTotal,
                        status: 'pending'
                    });
                    return next;
                });
            });

            Logger.debug('[BackgroundFetch] Started:', { id, requestCount: requests.length });

            // Wait for completion
            const result = await bgFetch.result;
            const records = await bgFetch.matchAll();
            const responses = await Promise.all(records.map((r: { responseReady: Promise<Response> }) => r.responseReady));

            // Update status
            setActiveFetches(prev => {
                const next = new Map(prev);
                next.set(id, {
                    id,
                    downloaded: bgFetch.downloaded,
                    total: bgFetch.downloadTotal,
                    status: result as BackgroundFetchStatus
                });
                return next;
            });

            return responses;
        } catch (err) {
            Logger.error('[BackgroundFetch] Failed:', { id, error: err });
            setActiveFetches(prev => {
                const next = new Map(prev);
                next.set(id, {
                    id,
                    downloaded: 0,
                    total: 0,
                    status: 'fail'
                });
                return next;
            });
            return null;
        }
    }, []);

    /**
     * Aborts an active background fetch.
     */
    const abortBackgroundFetch = useCallback(async (id: string): Promise<boolean> => {
        try {
            const registration = await navigator.serviceWorker?.ready;
            // @ts-expect-error - backgroundFetch not in TypeScript types
            const bgFetch = await registration?.backgroundFetch?.get(id);
            if (bgFetch) {
                await bgFetch.abort();
                setActiveFetches(prev => {
                    const next = new Map(prev);
                    next.delete(id);
                    return next;
                });
                return true;
            }
            return false;
        } catch (err) {
            Logger.warn('[BackgroundFetch] Abort failed:', { id, error: err });
            return false;
        }
    }, []);

    /**
     * Gets progress for a specific background fetch.
     */
    const getProgress = useCallback((id: string): BackgroundFetchProgress | undefined => {
        return activeFetches.get(id);
    }, [activeFetches]);

    return {
        startBackgroundFetch,
        abortBackgroundFetch,
        getProgress,
        activeFetches,
        isSupported
    };
}
