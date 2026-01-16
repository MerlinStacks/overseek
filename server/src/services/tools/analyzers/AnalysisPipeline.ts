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
import { MarketingStrategyAdvisor } from '../advisors/MarketingStrategyAdvisor';
import { SearchCampaignAdvisor } from '../advisors/SearchCampaignAdvisor';
import { getFeedbackContext, shouldFilterRecommendation } from '../feedback/FeedbackService';

// =============================================================================
// PIPELINE
// =============================================================================

export class AnalysisPipeline {

    /**
     * Run all analyzers and merge results.
     * @param accountId - The account to analyze
     * @param userContext - Optional business context from user (e.g., "Focus on summer products", "Upcoming sale")
     */
    static async runAll(accountId: string, userContext?: string): Promise<UnifiedAnalysis> {
        const startTime = Date.now();

        // Parse user context for priority keywords
        const contextKeywords = userContext ? this.parseContextKeywords(userContext) : [];

        // Run all analyzers in parallel
        const [
            multiPeriod,
            crossChannel,
            ltv,
            funnel,
            audience,
            productOpp,
            keywordOpp,
            strategy,
            searchCampaigns
        ] = await Promise.all([
            MultiPeriodAnalyzer.analyze(accountId),
            CrossChannelAnalyzer.analyze(accountId),
            LTVAnalyzer.analyze(accountId),
            FunnelAnalyzer.analyze(accountId),
            AudienceAnalyzer.analyze(accountId),
            ProductOpportunityAnalyzer.analyze(accountId),
            KeywordOpportunityAnalyzer.analyze(accountId),
            MarketingStrategyAdvisor.analyze(accountId),  // Strategic layer
            SearchCampaignAdvisor.analyze(accountId)       // Search campaign layer
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

        // Strategic recommendations (executive-level insights)
        if (strategy.recommendations) allActions.push(...strategy.recommendations);

        // Search campaign recommendations
        if (searchCampaigns.recommendations) allActions.push(...searchCampaigns.recommendations);

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

        // Apply feedback-based filtering
        const feedbackContext = await getFeedbackContext(accountId);
        let filteredActions = sortedActions.filter(
            rec => !shouldFilterRecommendation(rec, feedbackContext)
        );

        // Apply user context-based priority boosting
        if (contextKeywords.length > 0) {
            filteredActions = filteredActions.map(rec => {
                const headlineLower = rec.headline.toLowerCase();
                const matchesContext = contextKeywords.some(kw => headlineLower.includes(kw));

                if (matchesContext && rec.priority > 1) {
                    // Boost priority for items matching user's stated focus
                    return { ...rec, priority: (rec.priority - 1) as 1 | 2 | 3, contextBoosted: true };
                }
                return rec;
            });

            // Re-sort after boosting
            filteredActions.sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return b.confidence - a.confidence;
            });
        }

        Logger.debug('Filtered recommendations based on feedback', {
            accountId,
            before: sortedActions.length,
            after: filteredActions.length,
            filteredOut: sortedActions.length - filteredActions.length,
            dismissedIdsCount: feedbackContext.dismissedIds.size,
            feedbackEntries: feedbackContext.totalFeedbackEntries,
            contextKeywords: contextKeywords.length
        });

        // Build unified result
        const hasData = multiPeriod.hasData || crossChannel.hasData ||
            ltv.hasData || funnel.hasData || audience.hasData ||
            productOpp.hasData || keywordOpp.hasData || strategy.hasData ||
            searchCampaigns.hasData;


        return {
            hasData,
            suggestions: sortedSuggestions,
            actionableRecommendations: filteredActions,
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
                analyzersRun: 9,
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

    /**
     * Parse user context for priority keywords.
     * Extracts product names, categories, and focus areas from user's notes.
     */
    private static parseContextKeywords(context: string): string[] {
        const keywords: string[] = [];
        const contextLower = context.toLowerCase();

        // Extract quoted terms (e.g., "summer products")
        const quotedMatches = context.match(/"([^"]+)"/g);
        if (quotedMatches) {
            for (const match of quotedMatches) {
                keywords.push(match.replace(/"/g, '').toLowerCase().trim());
            }
        }

        // Extract focus patterns
        const focusPatterns = [
            /focus on\s+(.+?)(?:\.|,|$)/gi,
            /prioritize\s+(.+?)(?:\.|,|$)/gi,
            /push\s+(.+?)(?:\.|,|$)/gi,
            /promote\s+(.+?)(?:\.|,|$)/gi
        ];

        for (const pattern of focusPatterns) {
            let match;
            while ((match = pattern.exec(contextLower)) !== null) {
                const term = match[1].trim();
                if (term.length > 2 && term.length < 50) {
                    keywords.push(term);
                }
            }
        }

        // Common product categories
        const categories = ['summer', 'winter', 'holiday', 'sale', 'clearance', 'new arrival', 'best seller', 'premium', 'budget'];
        for (const cat of categories) {
            if (contextLower.includes(cat)) {
                keywords.push(cat);
            }
        }

        // Return unique keywords
        return [...new Set(keywords)];
    }
}
