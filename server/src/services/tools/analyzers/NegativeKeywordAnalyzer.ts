/**
 * Negative Keyword Analyzer
 *
 * Identifies wasted ad spend on irrelevant search terms by cross-referencing
 * Google Ads search term reports with Search Console data and the WooCommerce
 * product catalog.
 *
 * Why this matters: typical ecommerce accounts waste 5-15% of search spend
 * on terms that never convert and are unrelated to inventory.
 */

import { Logger } from '../../../utils/logger';
import { prisma } from '../../../utils/prisma';
import { GoogleAdsService } from '../../ads/GoogleAdsService';
import { SearchKeywordInsight } from '../../ads/types';
import {
    ActionableRecommendation,
    KeywordAction,
    createKeywordHeadline
} from '../types/ActionableTypes';

interface NegativeKeywordResult {
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

                result.suggestions.push({
                    id: `neg_kw_${kw.keywordText.replace(/\s+/g, '_').substring(0, 20)}`,
                    priority: kw.spend >= 20 ? 1 : kw.spend >= 10 ? 2 : 3,
                    category: 'optimization',
                    headline: `🛑 ${createKeywordHeadline(action)}`,
                    explanation: `"${kw.keywordText}" spent $${kw.spend.toFixed(2)} with ${kw.clicks} clicks but zero conversions. ` +
                        `This keyword has low relevance to your product catalog (${candidate.relevanceScore}% match).`,
                    dataPoints: [
                        `$${kw.spend.toFixed(2)} spent over 28 days`,
                        `${kw.clicks} clicks, 0 conversions`,
                        `${kw.ctr.toFixed(1)}% CTR at $${kw.cpc.toFixed(2)} CPC`,
                        `Campaign: ${kw.campaignName}`,
                        `Catalog relevance: ${candidate.relevanceScore}%`
                    ],
                    action,
                    confidence: this.calculateConfidence(kw, candidate.relevanceScore),
                    estimatedImpact: {
                        spendChange: -kw.spend,
                        timeframe: '30d'
                    },
                    platform: 'google',
                    source: 'NegativeKeywordAnalyzer',
                    tags: ['negative-keyword', 'waste-reduction', 'optimization']
                });

                result.summary.estimatedMonthlySavings += kw.spend;
            }

            result.summary.negativeCandidates = result.suggestions.length;
            result.summary.estimatedMonthlySavings = Math.round(result.summary.estimatedMonthlySavings * 100) / 100;

        } catch (error) {
            Logger.error('NegativeKeywordAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /** Aggregate search keywords from all Google Ads accounts */
    private static async getAllPaidKeywords(adAccountIds: string[]): Promise<SearchKeywordInsight[]> {
        const results = await Promise.all(
            adAccountIds.map(id => GoogleAdsService.getSearchKeywords(id, 28, 500).catch(() => []))
        );
        return results.flat();
    }

    /**
     * Extract product-related terms from WooCommerce catalog.
     * Returns a normalized set of words from product names and categories.
     */
    private static async getProductCatalogTerms(accountId: string): Promise<Set<string>> {
        const terms = new Set<string>();

        try {
            const products = await prisma.wooProduct.findMany({
                where: { accountId },
                select: { name: true, sku: true }
            });

            for (const product of products) {
                const words = (product.name + ' ' + (product.sku || ''))
                    .toLowerCase()
                    .replace(/[^\w\s]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w.length > 2);
                for (const word of words) terms.add(word);
            }
        } catch (error) {
            Logger.warn('Failed to fetch product catalog terms', { error });
        }

        return terms;
    }

    /**
     * Score how relevant a keyword is to the product catalog (0-100).
     * Higher = more relevant (should NOT be negated).
     */
    private static scoreRelevance(keywordText: string, productTerms: Set<string>): number {
        const words = keywordText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        if (words.length === 0) return 0;

        const matchedWords = words.filter(w => productTerms.has(w));
        return Math.round((matchedWords.length / words.length) * 100);
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

        return Math.min(95, score);
    }
}
