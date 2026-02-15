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
export function useSearchAnalytics(days: number = 28, siteUrl?: string) {
    const api = useApi();

    return useQuery<{ queries: QueryAnalytics[]; count: number }>({
        queryKey: ['search-console', 'analytics', days, siteUrl],
        queryFn: () => {
            const params = new URLSearchParams({ days: String(days) });
            if (siteUrl) params.set('siteUrl', siteUrl);
            return api.get(`/api/search-console/analytics?${params}`);
        },
        enabled: api.isReady,
        staleTime: 10 * 60 * 1000,
    });
}

/** Hook: Fetch keyword recommendations (low-hanging fruit + gaps + AI) */
export function useKeywordRecommendations(siteUrl?: string) {
    const api = useApi();

    return useQuery<RecommendationsResponse>({
        queryKey: ['search-console', 'recommendations', siteUrl],
        queryFn: () => {
            const params = siteUrl ? `?siteUrl=${encodeURIComponent(siteUrl)}` : '';
            return api.get(`/api/search-console/recommendations${params}`);
        },
        enabled: api.isReady,
        staleTime: 15 * 60 * 1000,
    });
}

/** Hook: Fetch trending keywords */
export function useKeywordTrends(siteUrl?: string) {
    const api = useApi();

    return useQuery<{ trends: QueryTrend[]; count: number }>({
        queryKey: ['search-console', 'trends', siteUrl],
        queryFn: () => {
            const params = siteUrl ? `?siteUrl=${encodeURIComponent(siteUrl)}` : '';
            return api.get(`/api/search-console/trends${params}`);
        },
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
    previousPosition: number | null;
    estimatedRevenue: number | null;
    estimatedSearchVolume: number | null;
    groupId: string | null;
    groupName?: string | null;
    tags: string[];
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

/* ─────────────────────────────────────────────────────
   Keyword Groups
   ───────────────────────────────────────────────────── */

/** Keyword group with aggregate metrics */
export interface KeywordGroup {
    id: string;
    name: string;
    color: string;
    keywordCount: number;
    avgPosition: number | null;
    totalClicks: number;
    avgCtr: number | null;
}

/** Hook: List all keyword groups */
export function useKeywordGroups() {
    const api = useApi();
    return useQuery<{ groups: KeywordGroup[]; count: number }>({
        queryKey: ['search-console', 'keyword-groups'],
        queryFn: () => api.get('/api/search-console/keyword-groups'),
        enabled: api.isReady,
        staleTime: 2 * 60 * 1000,
    });
}

/** Hook: Create a keyword group */
export function useCreateGroup() {
    const api = useApi();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { name: string; color?: string }) =>
            api.post('/api/search-console/keyword-groups', data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'keyword-groups'] });
        },
    });
}

/** Hook: Delete a keyword group */
export function useDeleteGroup() {
    const api = useApi();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (groupId: string) =>
            api.delete(`/api/search-console/keyword-groups/${groupId}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'keyword-groups'] });
            qc.invalidateQueries({ queryKey: ['search-console', 'tracked-keywords'] });
        },
    });
}

/** Hook: Assign keywords to a group */
export function useAssignKeywordsToGroup() {
    const api = useApi();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { keywordIds: string[]; groupId: string | null }) =>
            api.post('/api/search-console/keyword-groups/assign', data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'keyword-groups'] });
            qc.invalidateQueries({ queryKey: ['search-console', 'tracked-keywords'] });
        },
    });
}

/* ─────────────────────────────────────────────────────
   Competitor Analysis
   ───────────────────────────────────────────────────── */

/** Competitor domain */
export interface CompetitorDomain {
    id: string;
    domain: string;
    createdAt: string;
}

/** Gap analysis result */
export interface CompetitorAnalysis {
    competitor: string;
    sharedKeywords: Array<{ keyword: string; yourPosition: number; theirEstimate: string }>;
    yourOnlyKeywords: string[];
    theirOnlyKeywords: string[];
    overlapPct: number;
}

/** Hook: List competitor domains */
export function useCompetitors() {
    const api = useApi();
    return useQuery<{ competitors: CompetitorDomain[]; count: number }>({
        queryKey: ['search-console', 'competitors'],
        queryFn: () => api.get('/api/search-console/competitors'),
        enabled: api.isReady,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Add a competitor domain */
export function useAddCompetitor() {
    const api = useApi();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { domain: string }) =>
            api.post('/api/search-console/competitors', data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'competitors'] });
        },
    });
}

/** Hook: Remove a competitor domain */
export function useRemoveCompetitor() {
    const api = useApi();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (competitorId: string) =>
            api.delete(`/api/search-console/competitors/${competitorId}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'competitors'] });
        },
    });
}

/** Hook: Run competitor gap analysis */
export function useCompetitorAnalysis(domain?: string) {
    const api = useApi();
    return useQuery<CompetitorAnalysis>({
        queryKey: ['search-console', 'competitor-analysis', domain],
        queryFn: () => api.get(`/api/search-console/competitor-analysis${domain ? `?domain=${domain}` : ''}`),
        enabled: api.isReady && !!domain,
        staleTime: 10 * 60 * 1000,
    });
}

/* ─────────────────────────────────────────────────────
   Revenue Attribution
   ───────────────────────────────────────────────────── */

/** Keyword revenue entry */
export interface KeywordRevenue {
    keyword: string;
    clicks: number;
    sessions: number;
    conversions: number;
    estimatedRevenue: number;
    revenuePerClick: number;
}

/** Hook: Fetch keyword revenue report */
export function useKeywordRevenue() {
    const api = useApi();
    return useQuery<{ keywords: KeywordRevenue[]; count: number }>({
        queryKey: ['search-console', 'keyword-revenue'],
        queryFn: () => api.get('/api/search-console/keyword-revenue'),
        enabled: api.isReady,
        staleTime: 10 * 60 * 1000,
    });
}

/* ─────────────────────────────────────────────────────
   Cannibalization Detection
   ───────────────────────────────────────────────────── */

/** Cannibalization result */
export interface CannibalizationResult {
    keyword: string;
    pages: Array<{ url: string; clicks: number; impressions: number; position: number }>;
    severity: 'high' | 'medium' | 'low';
    recommendation: string;
}

/** Hook: Detect keyword cannibalization */
export function useCannibalization() {
    const api = useApi();
    return useQuery<{ keywords: CannibalizationResult[]; count: number }>({
        queryKey: ['search-console', 'cannibalization'],
        queryFn: () => api.get('/api/search-console/cannibalization'),
        enabled: api.isReady,
        staleTime: 15 * 60 * 1000,
    });
}

/* ─────────────────────────────────────────────────────
   AI Content Briefs
   ───────────────────────────────────────────────────── */

/** Content brief */
export interface ContentBrief {
    keyword: string;
    currentPosition: number | null;
    currentClicks: number;
    currentImpressions: number;
    brief: {
        suggestedTitle: string;
        metaDescription: string;
        wordCount: number;
        headingOutline: string[];
        keyTopics: string[];
        internalLinkSuggestions: string[];
        contentType: string;
        tone: string;
    };
    generatedAt: string;
}

/** Hook: Generate AI content brief */
export function useContentBrief() {
    const api = useApi();
    return useMutation<ContentBrief, Error, { keyword: string; keywordId?: string }>({
        mutationFn: (data: { keyword: string; keywordId?: string }) =>
            api.post('/api/search-console/content-brief', data),
    });
}

/* ─────────────────────────────────────────────────────
   Bulk Import
   ───────────────────────────────────────────────────── */

/** Hook: Bulk import keywords */
export function useBulkImportKeywords() {
    const api = useApi();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { keywords: string[]; targetUrl?: string }) =>
            api.post('/api/search-console/tracked-keywords/bulk', data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['search-console', 'tracked-keywords'] });
        },
    });
}

/* ─────────────────────────────────────────────────────
   SEO Digest
   ───────────────────────────────────────────────────── */

/** SEO digest */
export interface SeoDigest {
    generatedAt: string;
    period: { start: string; end: string };
    summary: {
        totalClicks: number;
        totalImpressions: number;
        avgPosition: number;
        clicksChange: number;
        impressionsChange: number;
        positionChange: number;
    };
    topMovers: {
        improved: Array<{ keyword: string; oldPosition: number; newPosition: number; delta: number }>;
        declined: Array<{ keyword: string; oldPosition: number; newPosition: number; delta: number }>;
    };
    topKeywords: Array<{ keyword: string; clicks: number; impressions: number; position: number; estimatedRevenue: number }>;
    newKeywords: Array<{ keyword: string; position: number; impressions: number }>;
    alerts: string[];
}

/** Hook: Fetch SEO digest preview */
export function useSeoDigest() {
    const api = useApi();
    return useQuery<SeoDigest>({
        queryKey: ['search-console', 'seo-digest'],
        queryFn: () => api.get('/api/search-console/seo-digest/preview'),
        enabled: api.isReady,
        staleTime: 15 * 60 * 1000,
    });
}
