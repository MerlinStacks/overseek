/**
 * React Query hooks for Search Console SEO data.
 *
 * Why separate hooks: keeps component code thin and allows
 * individual cache invalidation per data type.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './useApi';

/** Search Console connection status */
interface SearchConsoleStatus {
    connected: boolean;
    sites: Array<{ id: string; siteUrl: string; createdAt: string }>;
}

/** Query-level analytics row */
interface QueryAnalytics {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

/** Low-hanging fruit opportunity */
interface LowHangingFruit {
    query: string;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    estimatedUpside: number;
    suggestedAction: string;
}

/** Keyword gap for a product */
interface KeywordGap {
    productName: string;
    productCategory: string;
    suggestedKeywords: string[];
    priority: 'high' | 'medium' | 'low';
}

/** Trending keyword with growth metrics */
interface QueryTrend {
    query: string;
    currentClicks: number;
    previousClicks: number;
    currentImpressions: number;
    previousImpressions: number;
    currentPosition: number;
    previousPosition: number;
    impressionGrowthPct: number;
    clickGrowthPct: number;
    positionChange: number;
}

/** AI recommendation */
interface AIKeywordRecommendation {
    title: string;
    description: string;
    keywords: string[];
    priority: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    expectedImpact: string;
    actionType: 'content' | 'optimization' | 'technical' | 'trend';
}

/** Full recommendations response */
interface RecommendationsResponse {
    lowHangingFruit: LowHangingFruit[];
    keywordGaps: KeywordGap[];
    aiRecommendations: AIKeywordRecommendation[];
}

/** Hook: Check if Search Console is connected */
export function useSearchConsoleStatus() {
    const api = useApi();

    return useQuery<SearchConsoleStatus>({
        queryKey: ['search-console', 'status'],
        queryFn: () => api.get<SearchConsoleStatus>('/api/oauth/search-console/status'),
        enabled: api.isReady,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Fetch raw search analytics */
export function useSearchAnalytics(days: number = 28) {
    const api = useApi();

    return useQuery<{ queries: QueryAnalytics[]; count: number }>({
        queryKey: ['search-console', 'analytics', days],
        queryFn: () => api.get(`/api/search-console/analytics?days=${days}`),
        enabled: api.isReady,
        staleTime: 10 * 60 * 1000,
    });
}

/** Hook: Fetch keyword recommendations (low-hanging fruit + gaps + AI) */
export function useKeywordRecommendations() {
    const api = useApi();

    return useQuery<RecommendationsResponse>({
        queryKey: ['search-console', 'recommendations'],
        queryFn: () => api.get('/api/search-console/recommendations'),
        enabled: api.isReady,
        staleTime: 15 * 60 * 1000,
    });
}

/** Hook: Fetch trending keywords */
export function useKeywordTrends() {
    const api = useApi();

    return useQuery<{ trends: QueryTrend[]; count: number }>({
        queryKey: ['search-console', 'trends'],
        queryFn: () => api.get('/api/search-console/trends'),
        enabled: api.isReady,
        staleTime: 10 * 60 * 1000,
    });
}

/** Hook: Fetch top pages */
export function useTopPages(days: number = 28) {
    const api = useApi();

    return useQuery<{ pages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>; count: number }>({
        queryKey: ['search-console', 'pages', days],
        queryFn: () => api.get(`/api/search-console/pages?days=${days}`),
        enabled: api.isReady,
        staleTime: 10 * 60 * 1000,
    });
}

export type {
    SearchConsoleStatus,
    QueryAnalytics,
    LowHangingFruit,
    KeywordGap,
    QueryTrend,
    AIKeywordRecommendation,
    RecommendationsResponse,
};

/* ─────────────────────────────────────────────────────
   Keyword Tracking
   ───────────────────────────────────────────────────── */

/** Tracked keyword summary from the API */
interface TrackedKeywordSummary {
    id: string;
    keyword: string;
    targetUrl: string | null;
    currentPosition: number | null;
    currentCtr: number | null;
    currentImpressions: number | null;
    currentClicks: number | null;
    isActive: boolean;
    createdAt: string;
}

/** Single history data point for position charts */
interface RankHistoryPoint {
    date: string;
    position: number;
    clicks: number;
    impressions: number;
    ctr: number;
}

/** Hook: List all tracked keywords */
export function useTrackedKeywords() {
    const api = useApi();

    return useQuery<{ keywords: TrackedKeywordSummary[]; count: number }>({
        queryKey: ['search-console', 'tracked-keywords'],
        queryFn: () => api.get('/api/search-console/tracked-keywords'),
        enabled: api.isReady,
        staleTime: 2 * 60 * 1000,
    });
}

/** Hook: Get rank history for a specific keyword */
export function useKeywordHistory(keywordId: string | null, days: number = 30) {
    const api = useApi();

    return useQuery<{ history: RankHistoryPoint[]; count: number }>({
        queryKey: ['search-console', 'keyword-history', keywordId, days],
        queryFn: () => api.get(`/api/search-console/tracked-keywords/${keywordId}/history?days=${days}`),
        enabled: api.isReady && !!keywordId,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Add a keyword to tracking */
export function useAddKeyword() {
    const api = useApi();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: (data: { keyword: string; targetUrl?: string }) =>
            api.post('/api/search-console/tracked-keywords', data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'tracked-keywords'] });
        },
    });
}

/** Hook: Delete a keyword from tracking */
export function useDeleteKeyword() {
    const api = useApi();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: (keywordId: string) =>
            api.delete(`/api/search-console/tracked-keywords/${keywordId}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'tracked-keywords'] });
        },
    });
}

/** Hook: Trigger a manual position refresh for all tracked keywords */
export function useRefreshKeywords() {
    const api = useApi();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: () =>
            api.post('/api/search-console/tracked-keywords/refresh'),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'tracked-keywords'] });
        },
    });
}

export type { TrackedKeywordSummary, RankHistoryPoint };
