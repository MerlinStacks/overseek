/**
 * Search Console SEO data hooks backed by native fetch helpers.
 *
 * Why separate hooks: keeps component code thin and allows
 * targeted cache invalidation per data type.
 */

import { useApiQuery, useApiMutation } from './useApiQuery';
import { useApi } from './useApi';

const SEARCH_CONSOLE_SCOPE = 'search-console';

const scKey = (...parts: Array<string | number | null | undefined>) =>
    [SEARCH_CONSOLE_SCOPE, ...parts] as const;

const STATUS_KEY = scKey('status');
const TRACKED_KEYWORDS_KEY = scKey('tracked-keywords');
const KEYWORD_GROUPS_KEY = scKey('keyword-groups');
const COMPETITORS_KEY = scKey('competitors');

function withQuery(path: string, params: Record<string, string | number | undefined | null>) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.set(key, String(value));
        }
    }
    const query = searchParams.toString();
    return query ? `${path}?${query}` : path;
}

/** Search Console connection status */
interface SearchConsoleStatus {
    connected: boolean;
    sites: Array<{ id: string; siteUrl: string; createdAt: string }>;
    defaultSiteUrl?: string | null;
    authError?: boolean;
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

    return useApiQuery<SearchConsoleStatus>({
        queryKey: STATUS_KEY,
        queryFn: () => api.get<SearchConsoleStatus>('/api/oauth/search-console/status'),
        enabled: api.isReady,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Persist the selected default GSC site for the account */
export function useSetDefaultSite() {
    const api = useApi();
    return useApiMutation({
        mutationFn: (siteUrl: string) =>
            api.put('/api/oauth/search-console/default-site', { siteUrl }),
        invalidateQueries: [STATUS_KEY],
    });
}

/** Hook: Fetch raw search analytics */
export function useSearchAnalytics(days: number = 28, siteUrl?: string) {
    const api = useApi();

    return useApiQuery<{ queries: QueryAnalytics[]; count: number }>({
        queryKey: scKey('analytics', days, siteUrl),
        queryFn: () => api.get(withQuery('/api/search-console/analytics', { days, siteUrl })),
        enabled: api.isReady,
        staleTime: 10 * 60 * 1000,
        refetchInterval: 5 * 60 * 1000,
    });
}

/** Hook: Fetch keyword recommendations (low-hanging fruit + gaps + AI) */
export function useKeywordRecommendations(siteUrl?: string) {
    const api = useApi();

    return useApiQuery<RecommendationsResponse>({
        queryKey: scKey('recommendations', siteUrl),
        queryFn: () => api.get(withQuery('/api/search-console/recommendations', { siteUrl })),
        enabled: api.isReady,
        staleTime: 15 * 60 * 1000,
    });
}

/** Hook: Fetch keywords with biggest ranking movement */
export function useKeywordMovers(siteUrl?: string, days: number = 14) {
    const api = useApi();

    return useApiQuery<{ movers: QueryTrend[]; count: number; trends?: QueryTrend[] }>({
        queryKey: scKey('movers', siteUrl, days),
        queryFn: () => api.get(withQuery('/api/search-console/movers', { siteUrl, days })),
        enabled: api.isReady,
        staleTime: 10 * 60 * 1000,
        refetchInterval: 5 * 60 * 1000,
    });
}

/** @deprecated Use useKeywordMovers instead */
export const useKeywordTrends = useKeywordMovers;

export type {
    QueryAnalytics,
    LowHangingFruit,
    KeywordGap,
    QueryTrend,
    AIKeywordRecommendation,
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

    return useApiQuery<{ keywords: TrackedKeywordSummary[]; count: number }>({
        queryKey: TRACKED_KEYWORDS_KEY,
        queryFn: () => api.get('/api/search-console/tracked-keywords'),
        enabled: api.isReady,
        staleTime: 2 * 60 * 1000,
    });
}

/** Hook: Get rank history for a specific keyword */
export function useKeywordHistory(keywordId: string | null, days: number = 30) {
    const api = useApi();

    return useApiQuery<{ history: RankHistoryPoint[]; count: number }>({
        queryKey: scKey('keyword-history', keywordId, days),
        queryFn: () => api.get(`/api/search-console/tracked-keywords/${keywordId}/history?days=${days}`),
        enabled: api.isReady && !!keywordId,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Add a keyword to tracking */
export function useAddKeyword() {
    const api = useApi();
    return useApiMutation({
        mutationFn: (data: { keyword: string; targetUrl?: string }) =>
            api.post('/api/search-console/tracked-keywords', data),
        invalidateQueries: [TRACKED_KEYWORDS_KEY],
    });
}

/** Hook: Delete a keyword from tracking */
export function useDeleteKeyword() {
    const api = useApi();
    return useApiMutation({
        mutationFn: (keywordId: string) =>
            api.delete(`/api/search-console/tracked-keywords/${keywordId}`),
        invalidateQueries: [TRACKED_KEYWORDS_KEY],
    });
}

/** Hook: Trigger a manual position refresh for all tracked keywords */
export function useRefreshKeywords() {
    const api = useApi();
    return useApiMutation({
        mutationFn: () =>
            api.post('/api/search-console/tracked-keywords/refresh'),
        invalidateQueries: [TRACKED_KEYWORDS_KEY],
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
    return useApiQuery<{ groups: KeywordGroup[]; count: number }>({
        queryKey: KEYWORD_GROUPS_KEY,
        queryFn: () => api.get('/api/search-console/keyword-groups'),
        enabled: api.isReady,
        staleTime: 2 * 60 * 1000,
    });
}

/** Hook: Create a keyword group */
export function useCreateGroup() {
    const api = useApi();
    return useApiMutation({
        mutationFn: (data: { name: string; color?: string }) =>
            api.post('/api/search-console/keyword-groups', data),
        invalidateQueries: [KEYWORD_GROUPS_KEY],
    });
}

/** Hook: Delete a keyword group */
export function useDeleteGroup() {
    const api = useApi();
    return useApiMutation({
        mutationFn: (groupId: string) =>
            api.delete(`/api/search-console/keyword-groups/${groupId}`),
        invalidateQueries: [
            KEYWORD_GROUPS_KEY,
            TRACKED_KEYWORDS_KEY,
        ],
    });
}

/** Hook: Assign keywords to a group */
export function useAssignKeywordsToGroup() {
    const api = useApi();
    return useApiMutation({
        mutationFn: (data: { keywordIds: string[]; groupId: string | null }) =>
            api.post('/api/search-console/keyword-groups/assign', data),
        invalidateQueries: [
            KEYWORD_GROUPS_KEY,
            TRACKED_KEYWORDS_KEY,
        ],
    });
}

/* ─────────────────────────────────────────────────────
   Competitor Analysis & Intelligence
   ───────────────────────────────────────────────────── */

/** Competitor domain with tracking stats */
export interface CompetitorDomain {
    id: string;
    domain: string;
    notes: string | null;
    isActive: boolean;
    keywordCount: number;
    avgPosition: number | null;
    lastCheckedAt: string | null;
    createdAt: string;
}

/** Competitor keyword with SERP position data */
export interface CompetitorKeywordPosition {
    id: string;
    keyword: string;
    currentPosition: number | null;
    previousPosition: number | null;
    rankingUrl: string | null;
    positionChange: number | null;
    lastCheckedAt: string | null;
}

/** Significant competitor position change */
export interface CompetitorMovement {
    competitorDomain: string;
    keyword: string;
    previousPosition: number | null;
    newPosition: number | null;
    change: number;
    direction: 'improved' | 'declined' | 'entered' | 'dropped';
    date: string;
}

/** Side-by-side keyword comparison row */
export interface HeadToHeadRow {
    keyword: string;
    yourPosition: number | null;
    theirPosition: number | null;
    positionDelta: number | null;
    advantage: number | null;
}

/** Hook: List competitor domains */
export function useCompetitors() {
    const api = useApi();
    return useApiQuery<{ competitors: CompetitorDomain[]; count: number }>({
        queryKey: COMPETITORS_KEY,
        queryFn: () => api.get('/api/search-console/competitors'),
        enabled: api.isReady,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Add a competitor domain */
export function useAddCompetitor() {
    const api = useApi();
    return useApiMutation({
        mutationFn: (data: { domain: string }) =>
            api.post('/api/search-console/competitors', data),
        invalidateQueries: [COMPETITORS_KEY],
    });
}

/** Hook: Remove a competitor domain */
export function useRemoveCompetitor() {
    const api = useApi();
    return useApiMutation({
        mutationFn: (competitorId: string) =>
            api.delete(`/api/search-console/competitors/${competitorId}`),
        invalidateQueries: [COMPETITORS_KEY],
    });
}

/** Hook: Get tracked keyword positions for a competitor */
export function useCompetitorKeywords(competitorId: string | null) {
    const api = useApi();
    return useApiQuery<{ keywords: CompetitorKeywordPosition[]; count: number }>({
        queryKey: scKey('competitor-keywords', competitorId),
        queryFn: () => api.get(`/api/search-console/competitors/${competitorId}/keywords`),
        enabled: api.isReady && !!competitorId,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Fetch recent significant competitor position changes */
export function useCompetitorMovement(days: number = 7) {
    const api = useApi();
    return useApiQuery<{ movements: CompetitorMovement[]; count: number }>({
        queryKey: scKey('competitor-movement', days),
        queryFn: () => api.get(withQuery('/api/search-console/competitor-movement', { days })),
        enabled: api.isReady,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Side-by-side You vs Competitor keyword positions */
export function useCompetitorHeadToHead(domain: string | null) {
    const api = useApi();
    return useApiQuery<{ rows: HeadToHeadRow[]; count: number }>({
        queryKey: scKey('competitor-head-to-head', domain),
        queryFn: () => api.get(withQuery('/api/search-console/competitor-head-to-head', { domain })),
        enabled: api.isReady && !!domain,
        staleTime: 5 * 60 * 1000,
    });
}

/** Hook: Manually trigger a SERP position refresh for all competitors */
export function useRefreshCompetitorPositions() {
    const api = useApi();
    return useApiMutation({
        mutationFn: () => api.post('/api/search-console/competitors/refresh'),
        invalidateQueries: [
            COMPETITORS_KEY,
            scKey('competitor-keywords'),
            scKey('competitor-movement'),
            scKey('competitor-head-to-head'),
        ],
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
    return useApiQuery<{ keywords: KeywordRevenue[]; count: number }>({
        queryKey: scKey('keyword-revenue'),
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
    return useApiQuery<{ keywords: CannibalizationResult[]; count: number }>({
        queryKey: scKey('cannibalization'),
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
    return useApiMutation<ContentBrief, { keyword: string; keywordId?: string }>({
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
    return useApiMutation({
        mutationFn: (data: { keywords: string[]; targetUrl?: string }) =>
            api.post('/api/search-console/tracked-keywords/bulk', data),
        invalidateQueries: [TRACKED_KEYWORDS_KEY],
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
    return useApiQuery<SeoDigest>({
        queryKey: scKey('seo-digest'),
        queryFn: () => api.get('/api/search-console/seo-digest/preview'),
        enabled: api.isReady,
        staleTime: 15 * 60 * 1000,
    });
}
