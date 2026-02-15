/**
 * useProductSearchInsights — React Query hook for product-level GSC analytics.
 *
 * Why a dedicated hook: keeps the component thin and allows independent
 * cache invalidation from the global SEO keyword hooks. Product-level
 * data is scoped to a single permalink and doesn't need site-wide caches.
 */

import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import { useSearchConsoleStatus } from './useSeoKeywords';

/** Single query row returned by the page-analytics endpoint */
export interface ProductQueryRow {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

/** Aggregate summary computed client-side from query rows */
export interface ProductSearchSummary {
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
    avgCtr: number;
}

/**
 * Fetches organic search queries driving traffic to a specific product URL.
 * Returns query rows, a computed summary, connection status, and loading state.
 */
export function useProductSearchInsights(permalink: string | undefined) {
    const apiClient = useApi();
    const status = useSearchConsoleStatus();
    const isConnected = status.data?.connected ?? false;

    const queryResult = useQuery<ProductQueryRow[]>({
        queryKey: ['product-search-insights', permalink],
        queryFn: async () => {
            if (!permalink) return [];
            const res = await apiClient.get<{ queries: ProductQueryRow[] }>(
                `/search-console/page-analytics?pageUrl=${encodeURIComponent(permalink)}`
            );
            return res.queries;
        },
        enabled: apiClient.isReady && isConnected && !!permalink,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const queries = queryResult.data ?? [];

    /** Derive aggregate summary from individual query rows */
    const summary: ProductSearchSummary | null = queries.length > 0 ? {
        totalClicks: queries.reduce((s, q) => s + q.clicks, 0),
        totalImpressions: queries.reduce((s, q) => s + q.impressions, 0),
        avgPosition: Math.round((queries.reduce((s, q) => s + q.position, 0) / queries.length) * 10) / 10,
        avgCtr: Math.round((queries.reduce((s, q) => s + q.ctr, 0) / queries.length) * 100) / 100,
    } : null;

    return {
        queries,
        summary,
        isLoading: queryResult.isLoading,
        isConnected,
        isStatusLoading: status.isLoading,
    };
}
