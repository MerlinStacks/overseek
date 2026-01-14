/**
 * Analysis Pipeline
 * 
 * Orchestrates all AI Marketing Co-Pilot analyzers, runs them in parallel,
 * and merges results into a unified format.
 */

import { Logger } from '../../../utils/logger';
import {
    BaseAnalysisResult,
    Suggestion,
    UnifiedAnalysis,
    AnalysisMetadata
} from '../types/AnalysisTypes';
import { ActionableRecommendation } from '../types/ActionableTypes';
import { BaseAnalyzer } from './BaseAnalyzer';

// Import individual analyzers
import { MultiPeriodAnalyzer } from './MultiPeriodAnalyzer';
import { CrossChannelAnalyzer } from './CrossChannelAnalyzer';
import { LTVAnalyzer } from './LTVAnalyzer';
import { FunnelAnalyzer } from './FunnelAnalyzer';
import { AudienceAnalyzer } from './AudienceAnalyzer';
import { ProductOpportunityAnalyzer } from './ProductOpportunityAnalyzer';
import { KeywordOpportunityAnalyzer } from './KeywordOpportunityAnalyzer';

// =============================================================================
// PIPELINE
// =============================================================================

export class AnalysisPipeline {

    /**
     * Run all analyzers and merge results.
     */
    static async runAll(accountId: string): Promise<UnifiedAnalysis> {
        const startTime = Date.now();

        // Run all analyzers in parallel
        const [
            multiPeriod,
            crossChannel,
            ltv,
            funnel,
            audience,
            productOpp,
            keywordOpp
        ] = await Promise.all([
            MultiPeriodAnalyzer.analyze(accountId),
            CrossChannelAnalyzer.analyze(accountId),
            LTVAnalyzer.analyze(accountId),
            FunnelAnalyzer.analyze(accountId),
            AudienceAnalyzer.analyze(accountId),
            ProductOpportunityAnalyzer.analyze(accountId), // New
            KeywordOpportunityAnalyzer.analyze(accountId)  // New
        ]);

        // Collect all suggestions
        const allSuggestions: Suggestion[] = [];
        const allActions: ActionableRecommendation[] = [];

        // Collect actionable recommendations from new analyzers
        if (productOpp.unpromotedProducts) allActions.push(...productOpp.unpromotedProducts);
        if (productOpp.underperformingProducts) allActions.push(...productOpp.underperformingProducts);
        if (productOpp.highPotentialProducts) allActions.push(...productOpp.highPotentialProducts);

        if (keywordOpp.keywordOpportunities) allActions.push(...keywordOpp.keywordOpportunities);
        if (keywordOpp.negativeKeywordOpportunities) allActions.push(...keywordOpp.negativeKeywordOpportunities);
        if (keywordOpp.bidAdjustments) allActions.push(...keywordOpp.bidAdjustments);

        // Collect actionable recommendations from existing updated analyzers
        if (multiPeriod.actionableRecommendations) {
            allActions.push(...multiPeriod.actionableRecommendations);
        }

        // Convert legacy string suggestions to new format
        this.convertAndAddSuggestions(allSuggestions, multiPeriod.suggestions, 'MultiPeriodAnalyzer');
        this.convertAndAddSuggestions(allSuggestions, crossChannel.suggestions, 'CrossChannelAnalyzer');
        this.convertAndAddSuggestions(allSuggestions, ltv.suggestions, 'LTVAnalyzer');
        this.convertAndAddSuggestions(allSuggestions, funnel.suggestions, 'FunnelAnalyzer');
        this.convertAndAddSuggestions(allSuggestions, audience.suggestions, 'AudienceAnalyzer');

        // Deduplicate and sort
        const dedupedSuggestions = this.deduplicateSuggestions(allSuggestions);
        const sortedSuggestions = this.sortSuggestions(dedupedSuggestions);

        // Sort actionable recommendations by priority
        const sortedActions = allActions.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.confidence - a.confidence;
        });

        // Build unified result
        const hasData = multiPeriod.hasData || crossChannel.hasData ||
            ltv.hasData || funnel.hasData || audience.hasData ||
            productOpp.hasData || keywordOpp.hasData;

        return {
            hasData,
            suggestions: sortedSuggestions,
            actionableRecommendations: sortedActions,
            results: {
                multiPeriod: this.toBaseResult(multiPeriod, 'MultiPeriodAnalyzer', accountId, startTime),
                crossChannel: this.toBaseResult(crossChannel, 'CrossChannelAnalyzer', accountId, startTime),
                ltv: this.toBaseResult(ltv, 'LTVAnalyzer', accountId, startTime),
                funnel: this.toBaseResult(funnel, 'FunnelAnalyzer', accountId, startTime),
                audience: this.toBaseResult(audience, 'AudienceAnalyzer', accountId, startTime),
            },
            summary: {
                totalSuggestions: sortedSuggestions.length,
                urgentCount: sortedSuggestions.filter(s => s.priority === 1).length,
                importantCount: sortedSuggestions.filter(s => s.priority === 2).length,
                infoCount: sortedSuggestions.filter(s => s.priority === 3).length,
                topConfidence: sortedSuggestions[0]?.confidence || 0,
                analyzersRun: 5,
                totalDurationMs: Date.now() - startTime,
            },
            metadata: {
                analyzedAt: new Date(),
                durationMs: Date.now() - startTime,
                source: 'AnalysisPipeline',
                accountId,
            },
        };
    }

    /**
     * Convert legacy string suggestions to Suggestion objects.
     */
    private static convertAndAddSuggestions(
        target: Suggestion[],
        source: any[],
        analyzerName: string
    ): void {
        for (let i = 0; i < source.length; i++) {
            const item = source[i];

            if (typeof item === 'string') {
                // Legacy string format
                target.push({
                    id: `${analyzerName}_${i}`,
                    text: item,
                    source: analyzerName,
                    priority: this.inferPriority(item),
                    category: 'optimization',
                    confidence: 50,
                });
            } else if (item && typeof item === 'object') {
                // Already a Suggestion-like object
                target.push({
                    id: item.id || `${analyzerName}_${i}`,
                    text: item.text || String(item),
                    source: item.source || analyzerName,
                    priority: item.priority || 3,
                    category: item.category || 'optimization',
                    confidence: item.confidence || 50,
                    explanation: item.explanation,
                    dataPoints: item.dataPoints,
                    platform: item.platform,
                });
            }
        }
    }

    /**
     * Infer priority from suggestion text.
     */
    private static inferPriority(text: string): 1 | 2 | 3 {
        const lower = text.toLowerCase();
        if (lower.includes('🚨') || lower.includes('critical') || lower.includes('crash')) {
            return 1;
        }
        if (lower.includes('⚠️') || lower.includes('warning') || lower.includes('declining')) {
            return 2;
        }
        return 3;
    }

    /**
     * Remove duplicate suggestions (same text).
     */
    private static deduplicateSuggestions(suggestions: Suggestion[]): Suggestion[] {
        const seen = new Set<string>();
        return suggestions.filter(s => {
            const key = s.text.substring(0, 100);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Sort suggestions by priority (urgent first), then confidence (high first).
     */
    private static sortSuggestions(suggestions: Suggestion[]): Suggestion[] {
        return suggestions.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.confidence - a.confidence;
        });
    }

    /**
     * Convert analyzer result to BaseAnalysisResult format.
     */
    private static toBaseResult(
        result: any,
        source: string,
        accountId: string,
        startTime: number
    ): BaseAnalysisResult {
        return {
            hasData: result.hasData || false,
            suggestions: [], // Already extracted
            metadata: {
                analyzedAt: new Date(),
                durationMs: Date.now() - startTime,
                source,
                accountId,
            },
        };
    }
}
