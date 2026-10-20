/**
 * Negative Keyword Analyzer
 *
 * Flags paid targeting keywords for human review using catalog-word overlap.
 * This is not an actual search-term report or proof of irrelevant traffic.
 *
 * Why this matters: typical ecommerce accounts waste 5-15% of search spend
 * on terms that never convert and are unrelated to inventory.
 */

import { Logger } from '../../../utils/logger';
import { createHash } from 'node:crypto';
import { prisma } from '../../../utils/prisma';
import { GoogleAdsService } from '../../ads/GoogleAdsService';
import { SearchKeywordInsight } from '../../ads/types';
import {
    ActionableRecommendation,
    KeywordAction
} from '../types/ActionableTypes';

interface NegativeKeywordResult {
    currency?: string;
    hasData: boolean;
    suggestions: ActionableRecommendation[];
    summary: {
        totalKeywordsAnalyzed: number;
        negativeCandidates: number;
        estimatedMonthlySavings: number;
    };
}

export class NegativeKeywordAnalyzer {

    /**
     * Analyze paid keywords for negative keyword candidates.
     *
     * Criteria for flagging a keyword:
     * 1. Spend > $5 in the period (not just noise)
     * 2. Zero conversions (never converted)
     * 3. Not related to any product in the WooCommerce catalog
     */
    static async analyze(accountId: string): Promise<NegativeKeywordResult> {
        if (!accountId?.trim()) throw new Error('Account ID required');
        const result: NegativeKeywordResult = {
            hasData: false,
            suggestions: [],
            summary: { totalKeywordsAnalyzed: 0, negativeCandidates: 0, estimatedMonthlySavings: 0 }
        };

        try {
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId, platform: 'GOOGLE' }
            });

            if (adAccounts.length === 0) return result;

            // Fetch paid keywords + product catalog in parallel
            const [allKeywords, productNames] = await Promise.all([
                this.getAllPaidKeywords(adAccounts.map(a => a.id)),
                this.getProductCatalogTerms(accountId)
            ]);

            if (allKeywords.length === 0) return result;
            const currencies = new Set(allKeywords.map(kw => kw.currency?.trim().toUpperCase()));
            if (currencies.size !== 1 || !/^[A-Z]{3}$/.test([...currencies][0] || '')) throw new Error('Negative keyword analysis requires one known currency');
            result.currency = [...currencies][0];
            if (!allKeywords.every(kw => ['spend', 'conversions', 'clicks', 'ctr', 'cpc'].every(key => typeof kw[key as keyof SearchKeywordInsight] === 'number' && Number.isFinite(kw[key as keyof SearchKeywordInsight]) && Number(kw[key as keyof SearchKeywordInsight]) >= 0))) throw new Error('Invalid paid keyword metrics');

            result.hasData = true;
            result.summary.totalKeywordsAnalyzed = allKeywords.length;

            // Filter to keywords with spend but zero conversions
            const wastedKeywords = allKeywords.filter(kw =>
                kw.spend >= 5 && kw.conversions === 0 && kw.clicks >= 3
            );

            // Score each wasted keyword by how unrelated it is to the product catalog
            const candidates = wastedKeywords
                .map(kw => ({
                    keyword: kw,
                    relevanceScore: this.scoreRelevance(kw.keywordText, productNames)
                }))
                .filter(c => c.relevanceScore < 30) // Low relevance = good neg keyword candidate
                .sort((a, b) => b.keyword.spend - a.keyword.spend)
                .slice(0, 15);

            for (const candidate of candidates) {
                const kw = candidate.keyword;
                const action: KeywordAction = {
                    adAccountId: kw.adAccountId,
                    actionType: 'add_negative',
                    keyword: kw.keywordText,
                    matchType: 'exact',
                    currentCpc: kw.cpc,
                    suggestedCpc: 0,
                    estimatedRoas: 0,
                    estimatedClicks: kw.clicks,
                    campaignId: kw.campaignId,
                    campaignName: kw.campaignName
                };
                const start = Date.parse(kw.dateStart);
                const end = Date.parse(kw.dateStop);
                const periodDays = (end - start) / 86400000 + 1;
                if (!Number.isFinite(periodDays) || periodDays < 1 || periodDays > 366) throw new Error('Invalid keyword reporting period');
                const projectedSpend = kw.spend * 30 / periodDays;
                if (!Number.isFinite(projectedSpend)) throw new Error('Keyword spend exceeds numeric range');
                const money = (amount: number) => `${result.currency} ${amount.toFixed(2)}`;

                result.suggestions.push({
                    id: `neg_kw_${createHash('sha256').update(JSON.stringify([accountId, kw.adAccountId, kw.campaignId, kw.adGroupId, kw.keywordId, kw.keywordText, kw.matchType])).digest('hex').slice(0, 24)}`,
                    priority: kw.spend >= 20 ? 1 : kw.spend >= 10 ? 2 : 3,
                    category: 'optimization',
                    headline: `Review negative keyword candidate: "${kw.keywordText}"`,
                    explanation: `"${kw.keywordText}" spent ${money(kw.spend)} with ${kw.clicks} clicks and no reported conversions. ` +
                        `Catalog-word overlap is ${candidate.relevanceScore}%, not a measured relevance score. Review actual search terms, brand names and conversion lag before blocking traffic. Projected spend is not guaranteed savings.`,
                    dataPoints: [
                        `${money(kw.spend)} spent from ${kw.dateStart} to ${kw.dateStop}`,
                        `${kw.clicks} clicks, 0 conversions`,
                        `${kw.ctr.toFixed(1)}% CTR at ${money(kw.cpc)} CPC`,
                        `Campaign: ${kw.campaignName}`,
                        `Catalog-word overlap: ${candidate.relevanceScore}%`,
                        `Projected 30-day spend exposure: ${money(projectedSpend)} (not guaranteed savings)`
                    ],
                    action,
                    confidence: this.calculateConfidence(kw, candidate.relevanceScore),
                    estimatedImpact: {
                        spendChange: -projectedSpend,
                        timeframe: '30d'
                    },
                    platform: 'google',
                    source: 'NegativeKeywordAnalyzer',
                    tags: ['negative-keyword', 'waste-reduction', 'optimization']
                });

                result.summary.estimatedMonthlySavings += projectedSpend;
                if (!Number.isFinite(result.summary.estimatedMonthlySavings)) throw new Error('Keyword spend exceeds numeric range');
            }

            result.summary.negativeCandidates = result.suggestions.length;
            result.summary.estimatedMonthlySavings = Math.round(result.summary.estimatedMonthlySavings * 100) / 100;

        } catch (error) {
            Logger.error('NegativeKeywordAnalyzer failed', { error, accountId });
            throw error;
        }

        return result;
    }

    /** Aggregate search keywords from all Google Ads accounts */
    private static async getAllPaidKeywords(adAccountIds: string[]): Promise<Array<SearchKeywordInsight & { adAccountId: string }>> {
        const results = await Promise.all(
            adAccountIds.map(async adAccountId => {
                const rows = await GoogleAdsService.getSearchKeywords(adAccountId, 28, 500, { strict: true });
                if (rows.length >= 500) throw new Error('Paid keywords reached the analysis limit');
                return rows.map(row => ({ ...row, adAccountId }));
            })
        );
        const unique = new Map(results.flat().map(row => [JSON.stringify([row.adAccountId, row.campaignId, row.adGroupId, row.keywordId, row.keywordText, row.matchType]), row]));
        return [...unique.values()];
    }

    /**
     * Extract product-related terms from WooCommerce catalog.
     * Returns a normalized set of words from product names and SKUs.
     */
    private static async getProductCatalogTerms(accountId: string): Promise<Set<string>> {
        const terms = new Set<string>();

        const products = await prisma.wooProduct.findMany({
            where: { accountId },
            select: { name: true, sku: true }
        });

        for (const product of products) {
            const words = this.words(product.name + ' ' + (product.sku || ''));
            for (const word of words) terms.add(word);
        }
        if (terms.size === 0) throw new Error('Product catalog terms are unavailable; negative keyword suggestions were withheld');

        return terms;
    }

    /**
     * Score how relevant a keyword is to the product catalog (0-100).
     * Higher = more relevant (should NOT be negated).
     */
    private static scoreRelevance(keywordText: string, productTerms: Set<string>): number {
        const words = this.words(keywordText);
        if (words.length === 0) return 100;

        const matchedWords = words.filter(w => productTerms.has(w));
        return Math.round((matchedWords.length / words.length) * 100);
    }

    private static words(text: string): string[] {
        return [...new Set(text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(word => word.length >= 2))];
    }

    /** Confidence score for a negative keyword recommendation */
    private static calculateConfidence(kw: SearchKeywordInsight, relevanceScore: number): number {
        let score = 30;

        // More spend with zero conversions = higher confidence it's waste
        if (kw.spend >= 30) score += 25;
        else if (kw.spend >= 15) score += 15;
        else if (kw.spend >= 5) score += 5;

        // More clicks with zero conversions = higher confidence
        if (kw.clicks >= 20) score += 20;
        else if (kw.clicks >= 10) score += 10;

        // Lower catalog relevance = higher confidence it's irrelevant
        if (relevanceScore === 0) score += 20;
        else if (relevanceScore < 20) score += 10;

        return Math.min(60, score); // Lexical overlap alone cannot establish irrelevance.
    }
}
