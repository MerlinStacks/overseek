/**
 * Search Console ↔ Ads Intelligence Bridge
 *
 * Correlates organic Search Console queries with paid Google Ads keywords
 * to identify cannibalization, untapped organic keywords, and wasted spend.
 *
 * Why this service exists: SC data and Ads data were completely siloed.
 * This bridge enables ROAS-aware decisions by comparing organic vs paid
 * performance for the same search terms.
 */

import { Logger } from '../../utils/logger';
import { SearchConsoleService, QueryAnalytics, QueryTrend } from '../search-console/SearchConsoleService';
import { GoogleAdsService } from './GoogleAdsService';
import { SearchKeywordInsight } from './types';
import { prisma } from '../../utils/prisma';

/** A query that exists in both organic and paid channels */
export interface OverlapQuery {
    query: string;
    organic: { clicks: number; impressions: number; ctr: number; position: number };
    paid: { clicks: number; impressions: number; spend: number; cpc: number; conversions: number; roas: number };
    /** Estimated wasted spend from cannibalization (higher = more waste) */
    estimatedWastedSpend: number;
    /** 0-100 confidence that this is truly cannibalized */
    cannibalizationScore: number;
}

/** An organic query with no paid equivalent */
export interface OrganicOnlyQuery {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    /** Estimated monthly value if converted to a paid keyword */
    estimatedPaidValue: number;
}

/** Full correlation result between SC and Ads */
export interface SearchAdsCorrelation {
    overlap: OverlapQuery[];
    organicOnly: OrganicOnlyQuery[];
    paidOnlyCount: number;
    summary: {
        totalOrganicQueries: number;
        totalPaidKeywords: number;
        overlapCount: number;
        organicOnlyCount: number;
        estimatedTotalWastedSpend: number;
        estimatedUntappedValue: number;
    };
}

export class SearchToAdsIntelligenceService {

    /**
     * Build a full organic ↔ paid correlation for an account.
     *
     * Why parallel fetches: SC and Google Ads data come from independent APIs.
     * Firing both simultaneously cuts wall-clock time roughly in half.
     */
    static async getCorrelation(accountId: string): Promise<SearchAdsCorrelation> {
        const emptyResult: SearchAdsCorrelation = {
            overlap: [], organicOnly: [], paidOnlyCount: 0,
            summary: { totalOrganicQueries: 0, totalPaidKeywords: 0, overlapCount: 0, organicOnlyCount: 0, estimatedTotalWastedSpend: 0, estimatedUntappedValue: 0 }
        };

        try {
            // Fetch google ad accounts for this overseek account
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId, platform: 'GOOGLE' }
            });

            if (adAccounts.length === 0) return emptyResult;

            // Fire SC queries + Ads queries in parallel
            const [organicQueries, paidKeywords] = await Promise.all([
                SearchConsoleService.getSearchAnalytics(accountId, { days: 28, rowLimit: 500 }),
                this.getAllPaidKeywords(adAccounts.map(a => a.id))
            ]);

            if (organicQueries.length === 0) return emptyResult;

            return this.correlate(organicQueries, paidKeywords);
        } catch (error) {
            Logger.error('SearchToAdsIntelligenceService.getCorrelation failed', { error, accountId });
            return emptyResult;
        }
    }

    /**
     * Get organic trend data for queries that overlap with paid keywords.
     * Used by BudgetRebalancerService to factor in organic trajectory.
     */
    static async getOrganicTrendsForPaidQueries(accountId: string): Promise<Map<string, QueryTrend>> {
        const trendMap = new Map<string, QueryTrend>();

        try {
            const trends = await SearchConsoleService.getSearchTrends(accountId, 28);
            for (const trend of trends) {
                trendMap.set(this.normalize(trend.query), trend);
            }
        } catch (error) {
            Logger.warn('Failed to fetch organic trends for paid queries', { error, accountId });
        }

        return trendMap;
    }

    /**
     * Aggregate paid keywords from all Google Ads accounts under one overseek account.
     * Why multiple accounts: users may have separate brand/non-brand accounts.
     */
    private static async getAllPaidKeywords(adAccountIds: string[]): Promise<SearchKeywordInsight[]> {
        const results = await Promise.all(
            adAccountIds.map(id => GoogleAdsService.getSearchKeywords(id, 28, 500).catch(() => []))
        );
        return results.flat();
    }

    /**
     * Core correlation logic: match organic queries to paid keywords.
     *
     * Why normalized matching: organic queries ("blue widget case") may not
     * exactly match paid keywords ("blue widget"). Normalizing and doing
     * substring checks catches most real-world overlaps without NLP overhead.
     */
    private static correlate(
        organic: QueryAnalytics[],
        paid: SearchKeywordInsight[]
    ): SearchAdsCorrelation {
        // Index paid keywords by normalized text for O(1) lookup
        const paidMap = new Map<string, SearchKeywordInsight>();
        for (const kw of paid) {
            const key = this.normalize(kw.keywordText);
            if (!key) continue;
            // Keep the one with highest spend if duplicates
            const existing = paidMap.get(key);
            if (!existing || kw.spend > existing.spend) {
                paidMap.set(key, kw);
            }
        }

        const overlap: OverlapQuery[] = [];
        const organicOnly: OrganicOnlyQuery[] = [];
        const matchedPaidKeys = new Set<string>();

        // Average paid conversion rate for estimating organic-only value
        const totalPaidClicks = paid.reduce((s, k) => s + k.clicks, 0);
        const totalPaidConversions = paid.reduce((s, k) => s + k.conversions, 0);
        const avgPaidCvr = totalPaidClicks > 0 ? totalPaidConversions / totalPaidClicks : 0.02;
        const totalPaidRevenue = paid.reduce((s, k) => s + k.conversionsValue, 0);
        const avgPaidAov = totalPaidConversions > 0 ? totalPaidRevenue / totalPaidConversions : 50;

        for (const oq of organic) {
            const normalizedQuery = this.normalize(oq.query);
            if (!normalizedQuery || normalizedQuery.length < 3) continue;

            // Try exact match first, then substring match
            const matchedKey = this.findPaidMatch(normalizedQuery, paidMap);

            if (matchedKey) {
                const pk = paidMap.get(matchedKey)!;
                matchedPaidKeys.add(matchedKey);

                const wastedSpend = this.estimateWastedSpend(oq, pk);
                const score = this.scoreCannibalization(oq, pk);

                overlap.push({
                    query: oq.query,
                    organic: { clicks: oq.clicks, impressions: oq.impressions, ctr: oq.ctr, position: oq.position },
                    paid: { clicks: pk.clicks, impressions: pk.impressions, spend: pk.spend, cpc: pk.cpc, conversions: pk.conversions, roas: pk.roas },
                    estimatedWastedSpend: wastedSpend,
                    cannibalizationScore: score
                });
            } else if (oq.impressions >= 100 && oq.position <= 20) {
                // Organic-only: decent impressions, worth considering for paid
                const estMonthlyClicks = oq.clicks * (30 / 28);
                const estValue = estMonthlyClicks * avgPaidCvr * avgPaidAov;

                organicOnly.push({
                    query: oq.query,
                    clicks: oq.clicks,
                    impressions: oq.impressions,
                    ctr: oq.ctr,
                    position: oq.position,
                    estimatedPaidValue: Math.round(estValue * 100) / 100
                });
            }
        }

        // Sort by impact
        overlap.sort((a, b) => b.estimatedWastedSpend - a.estimatedWastedSpend);
        organicOnly.sort((a, b) => b.estimatedPaidValue - a.estimatedPaidValue);

        const paidOnlyCount = paid.length - matchedPaidKeys.size;

        // Compute summary from full data before truncating
        const totalWastedSpend = Math.round(overlap.reduce((s, o) => s + o.estimatedWastedSpend, 0) * 100) / 100;
        const totalUntappedValue = Math.round(organicOnly.reduce((s, o) => s + o.estimatedPaidValue, 0) * 100) / 100;

        return {
            overlap: overlap.slice(0, 50),
            organicOnly: organicOnly.slice(0, 50),
            paidOnlyCount,
            summary: {
                totalOrganicQueries: organic.length,
                totalPaidKeywords: paid.length,
                overlapCount: overlap.length,
                organicOnlyCount: organicOnly.length,
                estimatedTotalWastedSpend: totalWastedSpend,
                estimatedUntappedValue: totalUntappedValue
            }
        };
    }

    /**
     * Find a matching paid keyword for an organic query.
     * Tries exact match, then word-boundary-aware substring match.
     *
     * Why word boundaries: without them, a paid keyword like "ring" would
     * match organic queries containing "earring" or "engineering", producing
     * false cannibalization signals.
     */
    private static findPaidMatch(
        normalizedQuery: string,
        paidMap: Map<string, SearchKeywordInsight>
    ): string | null {
        // Exact match
        if (paidMap.has(normalizedQuery)) return normalizedQuery;

        // Substring match with word-boundary safety:
        // only match if the shorter string appears as whole words inside the longer.
        for (const [key] of paidMap) {
            // Require at least 4 chars for substring matching to avoid
            // single-word false positives like "ring" ↔ "earring"
            if (key.length < 4 && normalizedQuery.length < 4) continue;

            const wordBoundary = new RegExp(`\\b${this.escapeRegex(key)}\\b`);
            if (normalizedQuery.length > key.length && wordBoundary.test(normalizedQuery)) {
                return key;
            }

            const reverseWordBoundary = new RegExp(`\\b${this.escapeRegex(normalizedQuery)}\\b`);
            if (key.length > normalizedQuery.length && reverseWordBoundary.test(key)) {
                return key;
            }
        }
        return null;
    }

    /** Escape special regex characters in a search string */
    private static escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Estimate wasted spend from cannibalization.
     *
     * Formula: paid_clicks × CPC × (organic_CTR / (organic_CTR + paid_CTR))
     * Rationale: the organic_CTR fraction approximates how many paid clicks
     * the user would have gotten organically for free.
     */
    private static estimateWastedSpend(organic: QueryAnalytics, paid: SearchKeywordInsight): number {
        if (organic.ctr <= 0 || paid.clicks <= 0) return 0;

        const paidCtr = paid.impressions > 0 ? (paid.clicks / paid.impressions) * 100 : 0;
        const organicShare = organic.ctr / (organic.ctr + paidCtr);

        return Math.round(paid.clicks * paid.cpc * organicShare * 100) / 100;
    }

    /**
     * Score cannibalization risk 0-100.
     * Higher score = more likely you're paying for clicks organic already delivers.
     */
    private static scoreCannibalization(organic: QueryAnalytics, paid: SearchKeywordInsight): number {
        let score = 0;

        // Strong organic position is highest signal
        if (organic.position <= 3) score += 35;
        else if (organic.position <= 5) score += 25;
        else if (organic.position <= 10) score += 10;

        // High organic CTR means users already click the organic result
        if (organic.ctr >= 8) score += 25;
        else if (organic.ctr >= 5) score += 15;
        else if (organic.ctr >= 2) score += 5;

        // High paid CPC means the waste is expensive
        if (paid.cpc >= 2) score += 20;
        else if (paid.cpc >= 1) score += 10;
        else if (paid.cpc >= 0.5) score += 5;

        // Low paid ROAS means the paid coverage isn't even converting well
        if (paid.roas < 1 && paid.spend > 10) score += 15;
        else if (paid.roas < 2 && paid.spend > 10) score += 5;

        return Math.min(100, score);
    }

    /** Lowercase, strip punctuation, collapse whitespace */
    private static normalize(text: string): string {
        return text.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
    }
}
