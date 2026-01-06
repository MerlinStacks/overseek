import { useState, useEffect } from 'react';

/**
 * Custom hook to detect mobile/tablet viewport.
 * Returns true for viewports < 1024px (lg breakpoint in Tailwind).
 * SSR-safe with proper hydration handling.
 */
export function useMobile(): boolean {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(max-width: 1023px)');

        // Set initial value
        setIsMobile(mediaQuery.matches);

        // Listen for changes
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mediaQuery.addEventListener('change', handler);

        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

    return isMobile;
}

/**
 * Hook for smaller mobile devices (< 768px / md breakpoint).
 */
export function useSmallMobile(): boolean {
    const [isSmallMobile, setIsSmallMobile] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(max-width: 767px)');
        setIsSmallMobile(mediaQuery.matches);

        const handler = (e: MediaQueryListEvent) => setIsSmallMobile(e.matches);
        mediaQuery.addEventListener('change', handler);

        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

    return isSmallMobile;
}
