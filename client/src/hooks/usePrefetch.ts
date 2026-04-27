import { useCallback } from 'react';

/**
 * Mapping of common routes to their lazy-loaded chunk names.
 * Used for prefetching chunks when user hovers over navigation links.
 */
const ROUTE_CHUNK_MAP: Record<string, () => Promise<unknown>> = {
    '/': () => import('../pages/DashboardPage'),
    '/orders': () => import('../pages/OrdersPage'),
    '/inbox': () => import('../pages/InboxPage'),
    '/inventory': () => import('../pages/InventoryPage'),
    '/customers': () => import('../pages/CustomersPage'),
    '/analytics': () => import('../pages/analytics/AnalyticsOverviewPage'),
    '/settings': () => import('../pages/SettingsPage'),
};

// Track which routes have been prefetched to avoid duplicate work
const prefetchedRoutes = new Set<string>();

/**
 * Hook for prefetching route chunks on user intent signals.
 * Improves perceived navigation speed by loading chunks before navigation.
 * 
 * Usage:
 * ```tsx
 * const { prefetch } = usePrefetch();
 * 
 * <Link 
 *   to="/orders" 
 *   onMouseEnter={() => prefetch('/orders')}
 *   onFocus={() => prefetch('/orders')}
 * >
 *   Orders
 * </Link>
 * ```
 */
export function usePrefetch() {
    const idleWindow = window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    };

    const prefetch = useCallback((path: string) => {
        // Normalize path (remove trailing slashes, take base path)
        const basePath = '/' + path.split('/').filter(Boolean)[0] || '/';

        // Skip if already prefetched
        if (prefetchedRoutes.has(basePath)) return;

        const loader = ROUTE_CHUNK_MAP[basePath];
        if (loader) {
            prefetchedRoutes.add(basePath);
            // Use requestIdleCallback for non-blocking prefetch
            if (idleWindow.requestIdleCallback) {
                idleWindow.requestIdleCallback(() => {
                    loader().catch(() => {
                        // Silently fail - prefetch is opportunistic
                        prefetchedRoutes.delete(basePath);
                    });
                });
            } else {
                // Fallback for Safari
                setTimeout(() => {
                    loader().catch(() => {
                        prefetchedRoutes.delete(basePath);
                    });
                }, 100);
            }
        }
    }, [idleWindow]);

    const prefetchOnIdle = useCallback((paths: string[]) => {
        // Prefetch multiple routes when browser is idle
        if (idleWindow.requestIdleCallback) {
            idleWindow.requestIdleCallback(() => {
                paths.forEach(prefetch);
            }, { timeout: 3000 });
        } else {
            setTimeout(() => paths.forEach(prefetch), 2000);
        }
    }, [prefetch, idleWindow]);

    return { prefetch, prefetchOnIdle };
}
