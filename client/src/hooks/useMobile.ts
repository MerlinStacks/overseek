import { useSyncExternalStore } from 'react';

/**
 * Get the current mobile state from window.
 * Safe for SSR - returns false on server.
 */
function getIsMobile(): boolean {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 1024;
}

/**
 * Subscribe to window resize events.
 */
function subscribe(callback: () => void): () => void {
    window.addEventListener('resize', callback);
    return () => window.removeEventListener('resize', callback);
}

/**
 * Custom hook to detect mobile/tablet viewport.
 * Returns true for viewports < 1024px (lg breakpoint in Tailwind).
 * Uses useSyncExternalStore for proper SSR/hydration handling.
 */
export function useMobile(): boolean {
    // Use useSyncExternalStore for proper hydration
    return useSyncExternalStore(
        subscribe,
        getIsMobile, // Client snapshot
        () => false  // Server snapshot (SSR fallback)
    );
}
