/**
 * Marketing Knowledge Base
 * 
 * Curated best practices and platform-specific rules for ad optimization.
 * Rules are evaluated against campaign context to generate relevant recommendations.
 * 
 * Part of AI Marketing Co-Pilot Phase 4.
 */

import { CampaignType } from '../AdContext';


export interface AnalysisContext {
    platform: 'google' | 'meta' | 'both';
    campaignType: CampaignType;
    campaignName: string;

    // Metrics
    spend: number;
    roas: number;
    ctr: number;
    cpc: number;
    cpa: number;
    cpm: number;
    conversions: number;
    impressions: number;
    clicks: number;

    // Trends
    roasTrend: 'improving' | 'stable' | 'declining';
    ctrTrend: 'improving' | 'stable' | 'declining';

    // Context
    daysSinceLaunch?: number;
    frequencyScore?: number;
    isLearning?: boolean;
    funnelStage: 'awareness' | 'consideration' | 'conversion' | 'retention';
}

export interface KnowledgeEntry {
    id: string;
    platform: 'google' | 'meta' | 'both';
    category: 'bid_strategy' | 'audience' | 'creative' | 'budget' | 'structure' | 'optimization';
    condition: (ctx: AnalysisContext) => boolean;
    recommendation: string;
    explanation: string;
    confidence: 'high' | 'medium';
    priority: 1 | 2 | 3;  // 1=urgent, 2=important, 3=info
    source?: string;
    tags: string[];
}

export interface MatchedRecommendation {
    id: string;
    text: string;
    explanation: string;
    confidence: 'high' | 'medium' | 'low';
    priority: 1 | 2 | 3;
    category: string;
    platform: string;
    dataPoints: string[];
    tags: string[];
}


const KNOWLEDGE_BASE: KnowledgeEntry[] = [
    // =========================================================================
    // GOOGLE ADS RULES
    // =========================================================================
    {
        id: 'google_pmax_learning',
        platform: 'google',
        category: 'structure',
        condition: (ctx) =>
            ctx.campaignType === 'shopping' &&
            ctx.conversions < 30 &&
            (ctx.daysSinceLaunch || 0) < 14,
        recommendation: '⏳ **Learning Phase**: Performance Max needs 30+ conversions before optimization. Avoid major changes.',
        explanation: 'Google\'s machine learning requires sufficient conversion data to optimize effectively. Making changes during the learning phase resets the algorithm.',
        confidence: 'high',
        priority: 2,
        source: 'Google Ads Best Practices',
        tags: ['pmax', 'learning', 'patience']
    },
    {
        id: 'google_pmax_low_conversions',
        platform: 'google',
        category: 'optimization',
        condition: (ctx) =>
            ctx.campaignType === 'shopping' &&
            ctx.conversions < 15 &&
            ctx.spend > 500 &&
            (ctx.daysSinceLaunch || 30) > 14,
        recommendation: '⚠️ **Low Conversion Volume**: PMax campaign has limited conversions. Consider switching to Maximize Clicks to build data.',
        explanation: 'Performance Max struggles with low conversion volume. Building click data first can help the algorithm learn your audience.',
        confidence: 'medium',
        priority: 2,
        tags: ['pmax', 'bid_strategy', 'conversions']
    },
    {
        id: 'google_search_low_quality_score',
        platform: 'google',
        category: 'optimization',
        condition: (ctx) =>
            ctx.campaignType === 'search' &&
            ctx.cpc > 3 &&
            ctx.ctr < 2,
        recommendation: '💡 **Quality Score Issue**: High CPC with low CTR suggests Quality Score problems. Review ad relevance and landing pages.',
        explanation: 'Google rewards relevant ads with lower CPCs. Improving ad copy relevance and landing page experience can significantly reduce costs.',
        confidence: 'high',
        priority: 2,
        tags: ['search', 'quality_score', 'cpc']
    },
    {
        id: 'google_broad_match_tip',
        platform: 'google',
        category: 'audience',
        condition: (ctx) =>
            ctx.campaignType === 'search' &&
            ctx.conversions > 30 &&
            ctx.roas > 2,
        recommendation: '🎯 **Expand with Broad Match**: Strong conversion data - consider testing broad match keywords with smart bidding.',
        explanation: 'With sufficient conversion history, Google\'s smart bidding can effectively optimize broad match keywords, potentially expanding reach.',
        confidence: 'medium',
        priority: 3,
        tags: ['search', 'keywords', 'expansion']
    },

    // =========================================================================
    // META ADS RULES
    // =========================================================================
    {
        id: 'meta_creative_fatigue',
        platform: 'meta',
        category: 'creative',
        condition: (ctx) =>
            (ctx.frequencyScore || 0) > 4 &&
            ctx.ctrTrend === 'declining',
        recommendation: '🎨 **Creative Fatigue**: High frequency with declining CTR. Refresh creatives or expand audience.',
        explanation: 'When users see the same ad repeatedly, engagement drops. Fresh creative or broader targeting can restore performance.',
        confidence: 'high',
        priority: 1,
        tags: ['creative', 'fatigue', 'frequency']
    },
    {
        id: 'meta_asc_recommendation',
        platform: 'meta',
        category: 'structure',
        condition: (ctx) =>
            ctx.conversions > 50 &&
            ctx.campaignType !== 'remarketing' &&
            ctx.funnelStage === 'conversion',
        recommendation: '🚀 **Try Advantage+**: With 50+ conversions, test Advantage+ Shopping Campaigns for automated optimization.',
        explanation: 'Advantage+ uses Meta\'s AI to automatically find converting audiences. Works best with strong conversion data.',
        confidence: 'medium',
        priority: 3,
        tags: ['advantage_plus', 'automation', 'scaling']
    },
    {
        id: 'meta_lookalike_tip',
        platform: 'meta',
        category: 'audience',
        condition: (ctx) =>
            ctx.funnelStage === 'consideration' &&
            ctx.cpa > 50 &&
            ctx.conversions > 10,
        recommendation: '👥 **Lookalike Optimization**: High CPA on prospecting. Test 1% lookalikes from purchasers instead of broader audiences.',
        explanation: 'Narrower lookalike audiences often convert better. Start with 1% and expand only if hitting scale limitations.',
        confidence: 'medium',
        priority: 2,
        tags: ['lookalike', 'audience', 'cpa']
    },
    {
        id: 'meta_cbo_learning',
        platform: 'meta',
        category: 'budget',
        condition: (ctx) =>
            ctx.isLearning === true &&
            ctx.spend < 200,
        recommendation: '📊 **CBO Learning**: Campaign is still learning. Avoid edits that reset the learning phase.',
        explanation: 'Meta campaigns need ~50 optimization events to exit learning. Significant edits restart this process.',
        confidence: 'high',
        priority: 2,
        tags: ['cbo', 'learning', 'patience']
    },

    // =========================================================================
    // CROSS-PLATFORM RULES
    // =========================================================================
    {
        id: 'low_ctr_general',
        platform: 'both',
        category: 'creative',
        condition: (ctx) =>
            ctx.ctr < 0.5 &&
            ctx.impressions > 10000 &&
            ctx.funnelStage !== 'awareness',
        recommendation: '📉 **Low CTR**: Click-through rate is below 0.5%. Test new ad copy, images, or offers.',
        explanation: 'Low CTR indicates your ads aren\'t resonating with the audience. A/B test creative elements to improve engagement.',
        confidence: 'high',
        priority: 2,
        tags: ['ctr', 'creative', 'testing']
    },
    {
        id: 'high_cpa_warning',
        platform: 'both',
        category: 'optimization',
        condition: (ctx) =>
            ctx.cpa > 100 &&
            ctx.conversions > 5 &&
            ctx.funnelStage === 'conversion',
        recommendation: '💸 **High CPA Alert**: Cost per acquisition exceeds $100. Review targeting, bids, and landing page conversion rate.',
        explanation: 'High CPA erodes profitability. Check if you\'re targeting too broadly or if your landing page has friction points.',
        confidence: 'high',
        priority: 1,
        tags: ['cpa', 'efficiency', 'optimization']
    },
    {
        id: 'roas_declining_trend',
        platform: 'both',
        category: 'optimization',
        condition: (ctx) =>
            ctx.roasTrend === 'declining' &&
            ctx.roas < 2 &&
            ctx.spend > 500,
        recommendation: '📉 **ROAS Declining**: Performance trending down. Audit recent changes, competitive landscape, and seasonal factors.',
        explanation: 'Declining ROAS can be caused by audience saturation, increased competition, seasonal changes, or landing page issues.',
        confidence: 'medium',
        priority: 1,
        tags: ['roas', 'trend', 'declining']
    },
    {
        id: 'awareness_roas_context',
        platform: 'both',
        category: 'structure',
        condition: (ctx) =>
            ctx.funnelStage === 'awareness' &&
            ctx.roas < 1 &&
            ctx.cpm < 20,
        recommendation: '✅ **Awareness Context**: Low ROAS is expected for awareness campaigns. CPM of $' + 'X is the key metric here.',
        explanation: 'Awareness campaigns build brand familiarity, not immediate conversions. Judge them on reach and CPM, not ROAS.',
        confidence: 'high',
        priority: 3,
        tags: ['awareness', 'funnel', 'context']
    },
    {
        id: 'remarketing_high_roas',
        platform: 'both',
        category: 'budget',
        condition: (ctx) =>
            ctx.funnelStage === 'retention' &&
            ctx.roas > 5,
        recommendation: '🎯 **Scale Remarketing**: Remarketing ROAS is excellent. Ensure budget isn\'t limiting impression share.',
        explanation: 'High-performing remarketing should be given sufficient budget to capture all available demand.',
        confidence: 'high',
        priority: 2,
        tags: ['remarketing', 'scaling', 'budget']
    },
    {
        id: 'no_conversions_check',
        platform: 'both',
        category: 'optimization',
        condition: (ctx) =>
            ctx.conversions === 0 &&
            ctx.clicks > 100,
        recommendation: '🔧 **Conversion Tracking Issue?**: 100+ clicks but no conversions. Verify tracking is configured correctly.',
        explanation: 'Zero conversions with significant traffic often indicates a tracking problem rather than a performance issue.',
        confidence: 'high',
        priority: 1,
        tags: ['tracking', 'conversions', 'debug']
    },
    {
        id: 'scale_winner',
        platform: 'both',
        category: 'budget',
        condition: (ctx) =>
            ctx.roas > 3 &&
            ctx.conversions > 20 &&
            ctx.spend < 1000,
        recommendation: '🚀 **Scale Opportunity**: Strong ROAS with room to grow. Consider 20-30% budget increase.',
        explanation: 'Profitable campaigns with stable performance can often handle gradual budget increases without efficiency loss.',
        confidence: 'medium',
        priority: 2,
        tags: ['scaling', 'budget', 'growth']
    },
];


export class MarketingKnowledgeBase {

    /**
     * Find all matching recommendations for a given context.
     */
    static findMatches(context: AnalysisContext): MatchedRecommendation[] {
        const matches: MatchedRecommendation[] = [];

        for (const entry of KNOWLEDGE_BASE) {
            // Check platform match
            if (entry.platform !== 'both' && entry.platform !== context.platform) {
                continue;
            }

            try {
                if (entry.condition(context)) {
                    matches.push({
                        id: entry.id,
                        text: entry.recommendation,
                        explanation: entry.explanation,
                        confidence: entry.confidence,
                        priority: entry.priority,
                        category: entry.category,
                        platform: entry.platform,
                        dataPoints: this.extractDataPoints(context, entry),
                        tags: entry.tags
                    });
                }
            } catch (error) {
                // Skip entries that error during condition evaluation
                continue;
            }
        }

        // Sort by priority
        matches.sort((a, b) => a.priority - b.priority);

        return matches;
    }

    /**
     * Extract relevant data points for a recommendation.
     */
    private static extractDataPoints(context: AnalysisContext, entry: KnowledgeEntry): string[] {
        const points: string[] = [];

        // Add relevant metrics based on category
        switch (entry.category) {
            case 'creative':
                points.push(`CTR: ${context.ctr.toFixed(2)}%`);
                if (context.frequencyScore) points.push(`Frequency: ${context.frequencyScore.toFixed(1)}`);
                break;
            case 'budget':
                points.push(`Spend: $${context.spend.toFixed(0)}`);
                points.push(`ROAS: ${context.roas.toFixed(2)}x`);
                break;
            case 'optimization':
                points.push(`ROAS: ${context.roas.toFixed(2)}x`);
                points.push(`CPA: $${context.cpa.toFixed(2)}`);
                points.push(`Conversions: ${context.conversions}`);
                break;
            case 'audience':
                points.push(`CPA: $${context.cpa.toFixed(2)}`);
                points.push(`Conversions: ${context.conversions}`);
                break;
            case 'structure':
                points.push(`Campaign Type: ${context.campaignType}`);
                points.push(`Funnel Stage: ${context.funnelStage}`);
                if (context.daysSinceLaunch) points.push(`Days Active: ${context.daysSinceLaunch}`);
                break;
            case 'bid_strategy':
                points.push(`CPC: $${context.cpc.toFixed(2)}`);
                points.push(`Conversions: ${context.conversions}`);
                break;
        }

        return points;
    }

    /**
     * Get all entries for a specific platform.
     */
    static getEntriesByPlatform(platform: 'google' | 'meta' | 'both'): KnowledgeEntry[] {
        return KNOWLEDGE_BASE.filter(e => e.platform === platform || e.platform === 'both');
    }

    /**
     * Get all entries for a specific category.
     */
    static getEntriesByCategory(category: string): KnowledgeEntry[] {
        return KNOWLEDGE_BASE.filter(e => e.category === category);
    }

    /**
     * Get count of entries.
     */
    static get entryCount(): number {
        return KNOWLEDGE_BASE.length;
    }

    /**
     * Find matches including dynamic learnings from the database.
     * This merges account-specific rules with the static knowledge base.
     */
    static async findMatchesWithLearnings(
        context: AnalysisContext,
        accountId: string
    ): Promise<MatchedRecommendation[]> {
        // Get static matches first
        const staticMatches = this.findMatches(context);

        try {
            // Dynamically import to avoid circular dependencies
            const { LearningService } = await import('./LearningService');

            // Load active learnings for this account
            const learnings = await LearningService.list(accountId, {
                platform: context.platform as any,
                includeInactive: false,
                includePending: false
            });

            // Convert learnings to matched recommendations
            // Note: Learning conditions are stored as text, so we do simple keyword matching
            const dynamicMatches: MatchedRecommendation[] = [];

            for (const learning of learnings) {
                // Simple heuristic matching based on condition text
                // In production, you might want more sophisticated matching
                const matchScore = this.evaluateLearningCondition(learning, context);

                if (matchScore > 0.5) {
                    dynamicMatches.push({
                        id: `learning_${learning.id}`,
                        text: learning.recommendation,
                        explanation: learning.explanation || `Custom rule: ${learning.condition}`,
                        confidence: learning.successRate > 60 ? 'high' : learning.successRate > 30 ? 'medium' : 'low',
                        priority: 2, // Default to important
                        category: learning.category,
                        platform: learning.platform,
                        dataPoints: [
                            `Applied: ${learning.appliedCount} times`,
                            `Success Rate: ${learning.successRate}%`
                        ],
                        tags: ['custom', learning.source]
                    });

                    // Record that this learning was applied
                    await LearningService.recordApplication(learning.id);
                }
            }

            // Merge and deduplicate (static rules take precedence by appearing first)
            const allMatches = [...staticMatches, ...dynamicMatches];

            // Sort by priority
            allMatches.sort((a, b) => a.priority - b.priority);

            return allMatches;
        } catch (error) {
            // Fall back to static matches if dynamic loading fails
            console.error('Error loading dynamic learnings:', error);
            return staticMatches;
        }
    }

    /**
     * Evaluate if a learning's condition matches the current context.
     * Returns a score from 0-1 indicating match strength.
     */
    private static evaluateLearningCondition(
        learning: { condition: string; platform: string; category: string },
        context: AnalysisContext
    ): number {
        const condition = learning.condition.toLowerCase();
        let score = 0;
        let checks = 0;

        // Check for ROAS mentions
        if (condition.includes('roas')) {
            checks++;
            if (condition.includes('low') && context.roas < 2) score++;
            else if (condition.includes('high') && context.roas > 3) score++;
            else if (condition.includes('declining') && context.roasTrend === 'declining') score++;
        }

        // Check for CTR mentions
        if (condition.includes('ctr')) {
            checks++;
            if (condition.includes('low') && context.ctr < 1) score++;
            else if (condition.includes('declining') && context.ctrTrend === 'declining') score++;
        }

        // Check for CPA mentions
        if (condition.includes('cpa')) {
            checks++;
            if (condition.includes('high') && context.cpa > 50) score++;
        }

        // Check for conversion mentions
        if (condition.includes('conversion')) {
            checks++;
            if (condition.includes('low') && context.conversions < 20) score++;
            else if (condition.includes('high') && context.conversions > 50) score++;
        }

        // Check for funnel stage
        if (condition.includes(context.funnelStage)) {
            checks++;
            score++;
        }

        // Check for campaign type
        if (condition.includes(context.campaignType)) {
            checks++;
            score++;
        }

        // Return normalized score
        return checks > 0 ? score / checks : 0;
    }
}
