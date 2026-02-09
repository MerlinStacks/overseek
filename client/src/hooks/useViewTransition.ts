import { useCallback, useState, useEffect } from 'react';

/**
 * Hook for View Transitions API
 *
 * Provides smooth, native-like page transition animations.
 * Falls back gracefully on unsupported browsers.
 *
 * @example
 * ```tsx
 * const { startViewTransition, isSupported } = useViewTransition();
 *
 * // Wrap navigation in a transition
 * startViewTransition(() => {
 *   navigate('/new-page');
 * });
 * ```
 */
export function useViewTransition() {
    const [isSupported] = useState(() => 'startViewTransition' in document);
    const [isTransitioning, setIsTransitioning] = useState(false);

    /**
     * Starts a view transition, wrapping the DOM update callback.
     * Falls back to immediate execution on unsupported browsers.
     */
    const startViewTransition = useCallback(async (updateCallback: () => void | Promise<void>) => {
        // Unsupported browsers - execute immediately
        if (!isSupported || !('startViewTransition' in document)) {
            await updateCallback();
            return;
        }

        setIsTransitioning(true);

        try {
            const transition = document.startViewTransition(async () => {
                await updateCallback();
            });

            await transition.finished;
        } catch {
            // Transition failed - DOM update should still have occurred
        } finally {
            setIsTransitioning(false);
        }
    }, [isSupported]);

    return {
        startViewTransition,
        isSupported,
        isTransitioning
    };
}

/**
 * CSS helper to add to your stylesheets for View Transitions.
 *
 * Add these styles to enable smooth page transitions:
 *
 * ```css
 * @view-transition {
 *   navigation: auto;
 * }
 *
 * ::view-transition-old(root) {
 *   animation: 150ms ease-out fade-out;
 * }
 *
 * ::view-transition-new(root) {
 *   animation: 150ms ease-in fade-in;
 * }
 *
 * @keyframes fade-out {
 *   from { opacity: 1; }
 *   to { opacity: 0; }
 * }
 *
 * @keyframes fade-in {
 *   from { opacity: 0; }
 *   to { opacity: 1; }
 * }
 * ```
 */
