import { record, rows, label, metric, count } from '../components/analytics/analyticsRead';
import type { TrackedKeywordSummary, RankHistoryPoint, QueryAnalytics, QueryTrend, LowHangingFruit, KeywordGap, AIKeywordRecommendation } from './useSeoKeywords';
const nullableMetric = (value: unknown) => value == null ? null : metric(value);
export function decodeSeoStatus(value: unknown) {
    const data = record(value);
    if (typeof data.connected !== 'boolean' || data.authError !== undefined && typeof data.authError !== 'boolean') throw new Error('Invalid Search Console status');
    const sites = data.sites == null && !data.connected ? [] : rows(data.sites).map(site => {
        const siteUrl = label(site.siteUrl);
        if (!/^sc-domain:[a-z\d.-]+$/i.test(siteUrl)) { const url = new URL(siteUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid site URL'); }
        return { id: label(site.id), siteUrl, createdAt: typeof site.createdAt === 'string' ? site.createdAt : '' };
    });
    if (new Set(sites.map(site => site.siteUrl)).size !== sites.length) throw new Error('Duplicate sites');
    return { connected: data.connected, authError: data.authError === true, sites,
        defaultSiteUrl: typeof data.defaultSiteUrl === 'string' && sites.some(site => site.siteUrl === data.defaultSiteUrl) ? data.defaultSiteUrl : null };
}
export function decodeSearchAnalytics(value: unknown) {
    const data = record(value); const seen = new Set<string>();
    const queries: QueryAnalytics[] = rows(data.queries).map(row => {
        const query = label(row.query); const clicks = count(row.clicks); const impressions = count(row.impressions); const position = metric(row.position);
        if (seen.has(query) || clicks > impressions || impressions > 0 && position < 1) throw new Error('Invalid query observation'); seen.add(query);
        return { query, clicks, impressions, position, ctr: impressions ? clicks / impressions * 100 : 0 };
    });
    return { queries, count: queries.length };
}
export function decodeMovers(value: unknown) {
    const data = record(value);
    const movers = rows(data.movers ?? data.trends).map(row => {
        label(row.query);
        for (const field of ['currentClicks', 'previousClicks', 'currentImpressions', 'previousImpressions', 'currentPosition', 'previousPosition']) metric(row[field]);
        for (const field of ['impressionGrowthPct', 'clickGrowthPct', 'positionChange']) if (typeof row[field] !== 'number' || !Number.isFinite(row[field])) throw new Error('Invalid movement');
        return row as unknown as QueryTrend;
    });
    return { movers, count: movers.length };
}
export function decodeTrackedKeywords(value: unknown) {
    const keywords = rows(record(value).keywords).map(row => {
        label(row.id); label(row.keyword);
        for (const field of ['currentPosition', 'previousPosition', 'currentClicks', 'currentImpressions', 'currentCtr', 'estimatedRevenue', 'estimatedSearchVolume']) nullableMetric(row[field]);
        if (!Array.isArray(row.tags) || row.tags.some(tag => typeof tag !== 'string') || typeof row.isActive !== 'boolean') throw new Error('Invalid tracked keyword');
        return row as unknown as TrackedKeywordSummary;
    });
    if (new Set(keywords.map(keyword => keyword.id)).size !== keywords.length) throw new Error('Duplicate keywords');
    return { keywords, count: keywords.length };
}
export function decodeHistory(value: unknown) {
    const history = rows(record(value).history).map(row => {
        const date = label(row.date); if (!Number.isFinite(Date.parse(date))) throw new Error('Invalid observation date');
        const position = metric(row.position); const clicks = count(row.clicks); const impressions = count(row.impressions);
        if (position < 1 || clicks > impressions) throw new Error('Invalid history observation');
        return { date, position, clicks, impressions, ctr: impressions ? clicks / impressions * 100 : 0 } satisfies RankHistoryPoint;
    }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    if (new Set(history.map(row => Date.parse(row.date))).size !== history.length) throw new Error('Duplicate observation dates');
    return { history, count: history.length };
}
export function decodeRecommendations(value: unknown) {
    const data = record(value);
    const lowHangingFruit = rows(data.lowHangingFruit).map(row => { label(row.query); label(row.suggestedAction); for (const field of ['position', 'impressions', 'clicks', 'ctr', 'estimatedUpside']) metric(row[field]); return row as unknown as LowHangingFruit; });
    const keywordGaps = rows(data.keywordGaps).map(row => { label(row.productName); label(row.productCategory); if (!['high', 'medium', 'low'].includes(row.priority as string) || !Array.isArray(row.suggestedKeywords) || row.suggestedKeywords.some(keyword => typeof keyword !== 'string' || !keyword.trim())) throw new Error('Invalid suggestions'); return row as unknown as KeywordGap; });
    const aiRecommendations = rows(data.aiRecommendations).map(row => { for (const field of ['title', 'description', 'expectedImpact']) label(row[field]); if (!['high', 'medium', 'low'].includes(row.priority as string) || !['high', 'medium', 'low'].includes(row.effort as string) || !['content', 'optimization', 'technical', 'trend'].includes(row.actionType as string) || !Array.isArray(row.keywords) || row.keywords.some(keyword => typeof keyword !== 'string' || !keyword.trim() || keyword.length > 200)) throw new Error('Invalid suggestions'); return row as unknown as AIKeywordRecommendation; });
    const availability = data.availability == null ? null : record(data.availability);
    const warnings = availability ? ['lowHangingFruit', 'keywordGaps', 'aiRecommendations'].filter(key => availability[key] !== true).map(key => `${key} unavailable`) : ['Recommendation coverage metadata unavailable'];
    return { lowHangingFruit, keywordGaps, aiRecommendations, warnings };
}
