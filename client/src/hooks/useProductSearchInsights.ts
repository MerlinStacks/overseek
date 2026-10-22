import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useApi } from './useApi';
import { isRecord } from '../utils/responseValidation';

export interface ProductQueryRow { query: string; clicks: number; impressions: number; ctr: number; position: number }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function decode(value: unknown): ProductQueryRow[] {
    if (!isRecord(value) || !Array.isArray(value.queries) || value.queries.length > 25000) throw new Error('Invalid search analytics.');
    const seen = new Set<string>();
    return value.queries.map(row => {
        if (!isRecord(row) || typeof row.query !== 'string' || !row.query.trim() || row.query.length > 10000 || seen.has(row.query) ||
            !finite(row.clicks) || !Number.isSafeInteger(row.clicks) || row.clicks < 0 || !finite(row.impressions) || !Number.isSafeInteger(row.impressions) || row.impressions < row.clicks ||
            !finite(row.position) || row.position < 0 || row.impressions > 0 && row.position < 1) throw new Error('Invalid search analytics.');
        seen.add(row.query);
        return { query: row.query, clicks: row.clicks, impressions: row.impressions, position: row.position, ctr: row.impressions ? row.clicks / row.impressions * 100 : 0 };
    });
}

/** Both reads and caches belong to the authenticated owner/account/session. */
export function useProductSearchInsights(permalink: string | undefined) {
    const api = useApi(); const { user, token } = useAuth();
    const ready = !!user?.id && !!token && api.isReady;
    const scope = [user?.id, api.accountId, token];
    const validUrl = (() => { try { const url = new URL(permalink || ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } })();
    const status = useQuery({
        queryKey: ['product-search-status', ...scope], enabled: ready, retry: false, gcTime: 0,
        queryFn: async ({ signal }) => {
            const value = await api.get<unknown>('/api/oauth/search-console/status', { signal });
            if (!isRecord(value) || typeof value.connected !== 'boolean') throw new Error('Search Console status is unavailable.');
            return value.connected;
        },
    });
    const isConnected = ready && status.data === true && !status.error;
    const query = useQuery({
        queryKey: ['product-search-insights', ...scope, permalink], enabled: isConnected && validUrl,
        staleTime: 5 * 60 * 1000, gcTime: 0, retry: false, refetchOnWindowFocus: false,
        queryFn: async ({ signal }) => decode(await api.get<unknown>(`/api/search-console/page-analytics?pageUrl=${encodeURIComponent(permalink!)}`, { signal })),
    });
    const error = !ready ? 'Sign in and select an account to view search insights.' : status.error ? 'Could not load Search Console status.' :
        !validUrl ? 'A valid public product URL is required.' : query.error ? 'Could not load valid search analytics. Please retry.' : null;
    const queries = isConnected && validUrl && !error ? query.data ?? [] : [];
    const totalClicks = queries.reduce((sum, row) => sum + row.clicks, 0);
    const totalImpressions = queries.reduce((sum, row) => sum + row.impressions, 0);
    const weightedPosition = queries.reduce((sum, row) => sum + row.position * row.impressions, 0);
    const summary = queries.length && Number.isSafeInteger(totalClicks) && Number.isSafeInteger(totalImpressions) && Number.isFinite(weightedPosition) ? {
        totalClicks, totalImpressions,
        avgPosition: totalImpressions > 0 ? weightedPosition / totalImpressions : null,
        avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions * 100 : null,
    } : null;
    return { queries, summary, error, isLoading: isConnected && validUrl && query.isPending, isConnected,
        isStatusLoading: ready && status.isPending, retry: () => { if (status.error) void status.refetch(); else if (isConnected && validUrl) void query.refetch(); } };
}
