import { useCallback, useRef } from 'react';

/**
 * Returns a stable function that only allows visibility-triggered refreshes
 * once per throttle window.
 */
export function useVisibilityRefreshThrottle(throttleMs: number = 45_000) {
    const lastRefreshRef = useRef<number>(0);

    return useCallback(() => {
        const now = Date.now();
        if (now - lastRefreshRef.current < throttleMs) {
            return false;
        }

        lastRefreshRef.current = now;
        return true;
    }, [throttleMs]);
}
