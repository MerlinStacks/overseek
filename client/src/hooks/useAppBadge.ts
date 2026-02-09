import { useCallback, useState } from 'react';
import { Logger } from '../utils/logger';

/**
 * Hook for PWA App Badging API
 *
 * Provides methods to set/clear the app badge on the device home screen.
 * Falls back gracefully on unsupported browsers.
 *
 * @example
 * ```tsx
 * const { setAppBadge, clearAppBadge, isBadgeSupported } = useAppBadge();
 *
 * // Show unread count
 * setAppBadge(5);
 *
 * // Clear on logout
 * clearAppBadge();
 * ```
 */
export function useAppBadge() {
    const [isBadgeSupported] = useState(() => 'setAppBadge' in navigator);

    /**
     * Sets the app badge count on the home screen icon.
     * @param count - Number to display. Pass 0 or omit to show a dot indicator.
     */
    const setAppBadge = useCallback(async (count?: number): Promise<boolean> => {
        if (!('setAppBadge' in navigator)) {
            return false;
        }

        try {
            await navigator.setAppBadge(count);
            Logger.debug('[AppBadge] Badge set:', { count });
            return true;
        } catch (err) {
            Logger.warn('[AppBadge] Failed to set badge:', { error: err });
            return false;
        }
    }, []);

    /**
     * Clears the app badge from the home screen icon.
     */
    const clearAppBadge = useCallback(async (): Promise<boolean> => {
        if (!('clearAppBadge' in navigator)) {
            return false;
        }

        try {
            await navigator.clearAppBadge();
            Logger.debug('[AppBadge] Badge cleared');
            return true;
        } catch (err) {
            Logger.warn('[AppBadge] Failed to clear badge:', { error: err });
            return false;
        }
    }, []);

    return {
        isBadgeSupported,
        setAppBadge,
        clearAppBadge
    };
}
