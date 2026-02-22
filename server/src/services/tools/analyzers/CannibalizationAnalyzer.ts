/**
 * Cannibalization Analyzer
 *
 * Detects paid/organic overlap where you're paying for clicks
 * that your organic listing would already capture.
 *
 * Why this matters: most ecommerce sites waste 10-25% of search ad spend
 * on terms where they already rank in the top 3 organically.
 */

import { Logger } from '../../../utils/logger';
import { SearchToAdsIntelligenceService, OverlapQuery } from '../../ads/SearchToAdsIntelligenceService';
import {
    ActionableRecommendation,
    KeywordAction,
    createKeywordHeadline
} from '../types/ActionableTypes';

interface CannibalizationResult {
    hasData: boolean;
    cannibalized: ActionableRecommendation[];
    paidOpportunities: ActionableRecommendation[];
    summary: {
        totalOverlapQueries: number;
        cannibalizationCount: number;
        paidOpportunityCount: number;
        estimatedMonthlyWaste: number;
    };
}

export class CannibalizationAnalyzer {

    /**
     * Analyze organic/paid overlap for cannibalization and paid opportunities.
     *
     * Two output types:
     * - cannibalized: keywords where organic dominates → recommend pausing paid
     * - paidOpportunities: keywords where organic is weak → recommend increasing paid
     */
    static async analyze(accountId: string): Promise<CannibalizationResult> {
        const result: CannibalizationResult = {
            hasData: false,
            cannibalized: [],
            paidOpportunities: [],
            summary: { totalOverlapQueries: 0, cannibalizationCount: 0, paidOpportunityCount: 0, estimatedMonthlyWaste: 0 }
        };

        try {
            const correlation = await SearchToAdsIntelligenceService.getCorrelation(accountId);
            if (correlation.overlap.length === 0) return result;

            result.hasData = true;
            result.summary.totalOverlapQueries = correlation.overlap.length;

            for (const overlap of correlation.overlap) {
                if (overlap.cannibalizationScore >= 50) {
                    result.cannibalized.push(this.buildCannibalizationRec(overlap));
                    result.summary.estimatedMonthlyWaste += overlap.estimatedWastedSpend;
                } else if (overlap.organic.position > 10 && overlap.paid.roas >= 2) {
                    // Organic is weak but paid converts well → increase paid
                    result.paidOpportunities.push(this.buildPaidOpportunityRec(overlap));
                }
            }

            result.summary.cannibalizationCount = result.cannibalized.length;
            result.summary.paidOpportunityCount = result.paidOpportunities.length;
            result.summary.estimatedMonthlyWaste = Math.round(result.summary.estimatedMonthlyWaste * 100) / 100;

        } catch (error) {
            Logger.error('CannibalizationAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /** Build a "pause this keyword" recommendation for cannibalized queries */
    private static buildCannibalizationRec(overlap: OverlapQuery): ActionableRecommendation {
        const action: KeywordAction = {
            actionType: 'pause_keyword',
            keyword: overlap.query,
            matchType: 'exact',
            currentCpc: overlap.paid.cpc,
            suggestedCpc: 0,
            estimatedRoas: 0,
            estimatedClicks: overlap.paid.clicks
        };

        return {
            id: `cannibal_${overlap.query.replace(/\s+/g, '_').substring(0, 20)}`,
            priority: overlap.estimatedWastedSpend >= 50 ? 1 : overlap.estimatedWastedSpend >= 20 ? 2 : 3,
            category: 'optimization',
            headline: `⚠️ Cannibalized: "${overlap.query}" — save ~$${overlap.estimatedWastedSpend.toFixed(0)}/mo`,
            explanation: `You rank #${overlap.organic.position.toFixed(0)} organically for "${overlap.query}" with ` +
                `${overlap.organic.ctr.toFixed(1)}% CTR, but you're also paying $${overlap.paid.cpc.toFixed(2)}/click ` +
                `for this term. Approx. $${overlap.estimatedWastedSpend.toFixed(2)} of your monthly paid spend on this ` +
                `keyword would come through organic clicks for free.`,
            dataPoints: [
                `Organic: Position #${overlap.organic.position.toFixed(1)}, ${overlap.organic.ctr.toFixed(1)}% CTR, ${overlap.organic.clicks} clicks`,
                `Paid: $${overlap.paid.spend.toFixed(2)} spend, ${overlap.paid.clicks} clicks, $${overlap.paid.cpc.toFixed(2)} CPC`,
                `Paid ROAS: ${overlap.paid.roas.toFixed(2)}x`,
                `Cannibalization score: ${overlap.cannibalizationScore}/100`,
                `Est. monthly savings: $${overlap.estimatedWastedSpend.toFixed(2)}`
            ],
            action,
            confidence: Math.min(90, overlap.cannibalizationScore),
            estimatedImpact: {
                spendChange: -overlap.estimatedWastedSpend,
                timeframe: '30d'
            },
            platform: 'google',
            source: 'CannibalizationAnalyzer',
            tags: ['cannibalization', 'waste-reduction', 'organic-overlap']
        };
    }

    /** Build an "increase bid" recommendation for queries where organic is weak */
    private static buildPaidOpportunityRec(overlap: OverlapQuery): ActionableRecommendation {
        const suggestedCpc = Math.min(overlap.paid.cpc * 1.3, 5); // 30% increase, capped at $5

        const action: KeywordAction = {
            actionType: 'adjust_bid',
            keyword: overlap.query,
            matchType: 'exact',
            currentCpc: overlap.paid.cpc,
            suggestedCpc,
            estimatedRoas: overlap.paid.roas,
            estimatedClicks: Math.round(overlap.paid.clicks * 1.3)
        };

        return {
            id: `paid_opp_${overlap.query.replace(/\s+/g, '_').substring(0, 20)}`,
            priority: overlap.paid.roas >= 4 ? 1 : 2,
            category: 'optimization',
            headline: `🚀 Increase bid: "${overlap.query}" — ${overlap.paid.roas.toFixed(1)}x ROAS, weak organic`,
            explanation: `"${overlap.query}" converts at ${overlap.paid.roas.toFixed(1)}x ROAS through paid search, ` +
                `but your organic position is #${overlap.organic.position.toFixed(0)} — too low to rely on. ` +
                `Consider increasing the bid to capture more of this high-converting traffic.`,
            dataPoints: [
                `Organic position: #${overlap.organic.position.toFixed(1)} (weak)`,
                `Paid ROAS: ${overlap.paid.roas.toFixed(2)}x`,
                `Current CPC: $${overlap.paid.cpc.toFixed(2)} → suggested: $${suggestedCpc.toFixed(2)}`,
                `${overlap.paid.conversions} paid conversions this period`
            ],
            action,
            confidence: 60,
            estimatedImpact: {
                revenueChange: overlap.paid.conversions * (overlap.paid.roas * overlap.paid.cpc) * 0.3,
                roasChange: overlap.paid.roas,
                timeframe: '30d'
            },
            platform: 'google',
            source: 'CannibalizationAnalyzer',
            tags: ['bid-optimization', 'paid-opportunity', 'organic-weak']
        };
    }
}
