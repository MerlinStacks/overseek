/**
 * Recommendation Engine
 * 
 * Unified recommendation generation with explainability and confidence scoring.
 * Combines analyzer outputs with knowledge base rules.
 * 
 * Part of AI Marketing Co-Pilot Phase 4.
 */

import { MarketingKnowledgeBase, AnalysisContext, MatchedRecommendation } from './MarketingKnowledgeBase';
import { getCampaignType, CampaignType } from '../AdContext';
import { CampaignInsight } from '../../ads/types';
import { Logger } from '../../../utils/logger';


export interface ExplainableRecommendation {
    id: string;
    text: string;
    priority: 1 | 2 | 3;
    category: string;

    // Explainability
    explanation: string;
    dataPoints: string[];

    // Confidence
    confidence: {
        level: 'high' | 'medium' | 'low';
        score: number;  // 0-100
        factors: string[];
    };

    // Metadata
    source: 'analyzer' | 'knowledge_base' | 'rule';
    platform?: string;
    campaignName?: string;
    tags: string[];
}

export interface RecommendationSummary {
    total: number;
    byPriority: { urgent: number; important: number; info: number };
    byCategory: Record<string, number>;
    avgConfidence: number;
    topRecommendations: ExplainableRecommendation[];
}


function calculateConfidence(
    recommendation: MatchedRecommendation,
    context: AnalysisContext
): { level: 'high' | 'medium' | 'low'; score: number; factors: string[] } {
    const factors: string[] = [];
    let score = 50; // Base score

    // Knowledge base confidence
    if (recommendation.confidence === 'high') {
        score += 20;
        factors.push('High-confidence knowledge base rule');
    } else if (recommendation.confidence === 'medium') {
        score += 10;
        factors.push('Medium-confidence knowledge base rule');
    }

    // Sample size boost
    if (context.conversions > 50) {
        score += 15;
        factors.push('Large conversion sample (50+)');
    } else if (context.conversions > 20) {
        score += 10;
        factors.push('Moderate conversion sample (20+)');
    } else if (context.conversions < 10) {
        score -= 10;
        factors.push('Limited conversion data (<10)');
    }

    // Spend threshold (more spend = more reliable)
    if (context.spend > 1000) {
        score += 10;
        factors.push('Substantial spend ($1000+)');
    } else if (context.spend < 100) {
        score -= 10;
        factors.push('Limited spend data (<$100)');
    }

    // Trend consistency
    if (context.roasTrend === 'declining' && recommendation.tags.includes('declining')) {
        score += 5;
        factors.push('Trend aligns with recommendation');
    }

    // Priority boost (urgent issues get slight confidence boost)
    if (recommendation.priority === 1) {
        score += 5;
        factors.push('Critical issue detected');
    }

    // Clamp score
    score = Math.max(20, Math.min(100, score));

    // Determine level
    let level: 'high' | 'medium' | 'low' = 'medium';
    if (score >= 75) level = 'high';
    else if (score < 50) level = 'low';

    return { level, score, factors };
}


export class RecommendationEngine {

    /**
     * Generate explainable recommendations for campaigns.
     */
    static generateFromCampaigns(
        campaigns: CampaignInsight[],
        platform: 'google' | 'meta',
        trends?: { roas: 'improving' | 'stable' | 'declining'; ctr: 'improving' | 'stable' | 'declining' }
    ): ExplainableRecommendation[] {
        const recommendations: ExplainableRecommendation[] = [];

        for (const campaign of campaigns) {
            try {
                const campaignType = getCampaignType(campaign.campaignName);
                const funnelStage = this.inferFunnelStage(campaignType);

                const context: AnalysisContext = {
                    platform,
                    campaignType,
                    campaignName: campaign.campaignName,
                    spend: campaign.spend,
                    roas: campaign.roas,
                    ctr: campaign.ctr,
                    cpc: campaign.cpc,
                    cpa: campaign.cpa,
                    cpm: campaign.impressions > 0 ? (campaign.spend / campaign.impressions) * 1000 : 0,
                    conversions: campaign.conversions,
                    impressions: campaign.impressions,
                    clicks: campaign.clicks,
                    roasTrend: trends?.roas || 'stable',
                    ctrTrend: trends?.ctr || 'stable',
                    funnelStage
                };

                // Get matching knowledge base recommendations
                const matches = MarketingKnowledgeBase.findMatches(context);

                for (const match of matches) {
                    const confidence = calculateConfidence(match, context);

                    recommendations.push({
                        id: `${match.id}_${campaign.campaignId}`,
                        text: match.text,
                        priority: match.priority,
                        category: match.category,
                        explanation: match.explanation,
                        dataPoints: match.dataPoints,
                        confidence,
                        source: 'knowledge_base',
                        platform,
                        campaignName: campaign.campaignName,
                        tags: match.tags
                    });
                }
            } catch (error) {
                Logger.warn('Failed to analyze campaign', { campaignId: campaign.campaignId, error });
            }
        }

        // Deduplicate similar recommendations
        const deduped = this.deduplicateRecommendations(recommendations);

        // Sort by priority, then confidence
        deduped.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.confidence.score - a.confidence.score;
        });

        return deduped;
    }

    /**
     * Generate a summary of recommendations.
     */
    static summarize(recommendations: ExplainableRecommendation[]): RecommendationSummary {
        const byCategory: Record<string, number> = {};
        let totalScore = 0;

        for (const rec of recommendations) {
            byCategory[rec.category] = (byCategory[rec.category] || 0) + 1;
            totalScore += rec.confidence.score;
        }

        return {
            total: recommendations.length,
            byPriority: {
                urgent: recommendations.filter(r => r.priority === 1).length,
                important: recommendations.filter(r => r.priority === 2).length,
                info: recommendations.filter(r => r.priority === 3).length
            },
            byCategory,
            avgConfidence: recommendations.length > 0 ? Math.round(totalScore / recommendations.length) : 0,
            topRecommendations: recommendations.slice(0, 5)
        };
    }

    /**
     * Convert an analyzer suggestion to explainable format.
     */
    static fromAnalyzerSuggestion(
        text: string,
        options: {
            category: string;
            explanation: string;
            dataPoints: string[];
            confidenceScore: number;
            tags?: string[];
        }
    ): ExplainableRecommendation {
        const priority = this.inferPriorityFromText(text);
        const level = options.confidenceScore >= 75 ? 'high' : options.confidenceScore >= 50 ? 'medium' : 'low';

        return {
            id: `analyzer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            text,
            priority,
            category: options.category,
            explanation: options.explanation,
            dataPoints: options.dataPoints,
            confidence: {
                level,
                score: options.confidenceScore,
                factors: [`Score: ${options.confidenceScore}`]
            },
            source: 'analyzer',
            tags: options.tags || []
        };
    }

    /**
     * Format recommendations for display (with explainability toggle).
     */
    static formatForDisplay(
        recommendations: ExplainableRecommendation[],
        includeExplanations: boolean = false
    ): string[] {
        return recommendations.map(rec => {
            let output = rec.text;

            if (includeExplanations) {
                output += `\n   → *Why*: ${rec.explanation}`;
                output += `\n   → *Confidence*: ${rec.confidence.level} (${rec.confidence.score}%)`;
                if (rec.dataPoints.length > 0) {
                    output += `\n   → *Data*: ${rec.dataPoints.join(' | ')}`;
                }
            }

            return output;
        });
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private static inferFunnelStage(type: CampaignType): 'awareness' | 'consideration' | 'conversion' | 'retention' {
        switch (type) {
            case 'awareness':
            case 'video':
            case 'display':
                return 'awareness';
            case 'prospecting':
            case 'search':
                return 'consideration';
            case 'shopping':
            case 'conversion':
            case 'brand':
                return 'conversion';
            case 'remarketing':
                return 'retention';
            default:
                return 'consideration';
        }
    }

    private static inferPriorityFromText(text: string): 1 | 2 | 3 {
        if (text.includes('🚨') || text.includes('Critical') || text.includes('Alert')) return 1;
        if (text.includes('⚠️') || text.includes('Warning')) return 1;
        if (text.includes('📉') || text.includes('Declining')) return 2;
        if (text.includes('💡') || text.includes('Opportunity')) return 2;
        if (text.includes('📈') || text.includes('✅')) return 3;
        return 2;
    }

    private static deduplicateRecommendations(
        recommendations: ExplainableRecommendation[]
    ): ExplainableRecommendation[] {
        const seen = new Map<string, ExplainableRecommendation>();

        for (const rec of recommendations) {
            // Use base ID (without campaign suffix) for deduplication
            const baseId = rec.id.split('_')[0] + '_' + rec.id.split('_')[1];

            if (!seen.has(baseId)) {
                seen.set(baseId, rec);
            } else {
                // Keep the one with higher confidence
                const existing = seen.get(baseId)!;
                if (rec.confidence.score > existing.confidence.score) {
                    seen.set(baseId, rec);
                }
            }
        }

        return Array.from(seen.values());
    }
}
