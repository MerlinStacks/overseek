/**
 * Search-to-Ads Intelligence Tools
 *
 * AI co-pilot tool handlers that expose the SC↔Ads intelligence bridge
 * data during conversational analysis. Surfaces cannibalization,
 * negative keyword candidates, and organic/paid correlation insights.
 */

import { SearchToAdsIntelligenceService } from '../ads/SearchToAdsIntelligenceService';
import { NegativeKeywordAnalyzer } from './analyzers/NegativeKeywordAnalyzer';
import { CannibalizationAnalyzer } from './analyzers/CannibalizationAnalyzer';

export class SearchToAdsTools {

    /**
     * Get organic ↔ paid keyword correlation with cannibalization scoring.
     * Includes overlap queries, organic-only opportunities, and wasted spend estimates.
     */
    static async getSearchAdsCorrelation(accountId: string) {
        try {
            const correlation = await SearchToAdsIntelligenceService.getCorrelation(accountId);

            return {
                summary: correlation.summary,
                topCannibalized: correlation.overlap
                    .filter(o => o.cannibalizationScore >= 50)
                    .sort((a, b) => b.estimatedWastedSpend - a.estimatedWastedSpend)
                    .slice(0, 10),
                topOrganicOpportunities: correlation.organicOnly
                    .sort((a, b) => b.estimatedPaidValue - a.estimatedPaidValue)
                    .slice(0, 10),
                paidOnlyCount: correlation.paidOnlyCount
            };
        } catch (error: any) {
            return {
                error: error.message || 'Failed to fetch SC↔Ads correlation',
                summary: null,
                topCannibalized: [],
                topOrganicOpportunities: [],
                paidOnlyCount: 0
            };
        }
    }

    /**
     * Get negative keyword suggestions — paid keywords with spend but zero
     * conversions that are unrelated to the product catalog.
     */
    static async getNegativeKeywordSuggestions(accountId: string) {
        try {
            const result = await NegativeKeywordAnalyzer.analyze(accountId);
            return {
                summary: result.summary,
                suggestions: result.suggestions.slice(0, 10).map(s => ({
                    headline: s.headline,
                    explanation: s.explanation,
                    dataPoints: s.dataPoints,
                    confidence: s.confidence,
                    estimatedSavings: s.estimatedImpact?.spendChange
                }))
            };
        } catch (error: any) {
            return {
                error: error.message || 'Failed to fetch negative keyword suggestions',
                summary: null,
                suggestions: []
            };
        }
    }

    /**
     * Get cannibalization analysis — queries where organic traffic
     * could replace paid clicks, plus paid opportunities where
     * organic is too weak to rely on.
     */
    static async getCannibalizationAnalysis(accountId: string) {
        try {
            const result = await CannibalizationAnalyzer.analyze(accountId);
            return {
                summary: result.summary,
                cannibalized: result.cannibalized.slice(0, 10).map(r => ({
                    headline: r.headline,
                    explanation: r.explanation,
                    dataPoints: r.dataPoints,
                    confidence: r.confidence,
                    estimatedSavings: r.estimatedImpact?.spendChange
                })),
                paidOpportunities: result.paidOpportunities.slice(0, 10).map(r => ({
                    headline: r.headline,
                    explanation: r.explanation,
                    dataPoints: r.dataPoints,
                    confidence: r.confidence,
                    estimatedRevenue: r.estimatedImpact?.revenueChange
                }))
            };
        } catch (error: any) {
            return {
                error: error.message || 'Failed to fetch cannibalization analysis',
                summary: null,
                cannibalized: [],
                paidOpportunities: []
            };
        }
    }
}
