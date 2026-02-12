/**
 * Search Console AI Tools
 *
 * Tool handlers for the AI co-pilot to access Search Console data
 * and keyword recommendations during conversational analysis.
 */

import { SearchConsoleService } from '../search-console/SearchConsoleService';
import { KeywordRecommendationService } from '../search-console/KeywordRecommendationService';

export class SearchConsoleTools {

    /**
     * Get SEO keyword recommendations combining Search Console data
     * with product catalog analysis.
     */
    static async getKeywordRecommendations(accountId: string) {
        try {
            const [lowHanging, gaps, trending] = await Promise.all([
                KeywordRecommendationService.getLowHangingFruit(accountId),
                KeywordRecommendationService.getKeywordGaps(accountId),
                KeywordRecommendationService.getTrendingKeywords(accountId)
            ]);

            return {
                lowHangingFruit: lowHanging.slice(0, 10),
                keywordGaps: gaps.slice(0, 10),
                trendingKeywords: trending.slice(0, 10),
                summary: {
                    opportunities: lowHanging.length,
                    gaps: gaps.length,
                    trending: trending.length,
                    estimatedTotalUpside: lowHanging.reduce((sum, k) => sum + k.estimatedUpside, 0)
                }
            };
        } catch (error: any) {
            return { error: error.message || 'Failed to fetch keyword recommendations', lowHangingFruit: [], keywordGaps: [], trendingKeywords: [], summary: null };
        }
    }

    /**
     * Get organic search performance overview from Search Console.
     */
    static async getOrganicPerformance(accountId: string, days: number = 28) {
        try {
            const clampedDays = Math.min(Math.max(days, 1), 365);
            const [queries, pages] = await Promise.all([
                SearchConsoleService.getSearchAnalytics(accountId, { days: clampedDays, rowLimit: 50 }),
                SearchConsoleService.getTopPages(accountId, clampedDays)
            ]);

            const totalClicks = queries.reduce((sum, q) => sum + q.clicks, 0);
            const totalImpressions = queries.reduce((sum, q) => sum + q.impressions, 0);
            const avgPosition = queries.length > 0
                ? Math.round((queries.reduce((sum, q) => sum + q.position, 0) / queries.length) * 10) / 10
                : 0;
            const avgCtr = totalImpressions > 0
                ? Math.round((totalClicks / totalImpressions) * 10000) / 100
                : 0;

            return {
                summary: {
                    totalClicks,
                    totalImpressions,
                    averagePosition: avgPosition,
                    averageCTR: avgCtr,
                    totalQueries: queries.length,
                    period: `${clampedDays} days`
                },
                topQueries: queries.slice(0, 20),
                topPages: pages.slice(0, 10)
            };
        } catch (error: any) {
            return { error: error.message || 'Failed to fetch organic performance', summary: null, topQueries: [], topPages: [] };
        }
    }
}
