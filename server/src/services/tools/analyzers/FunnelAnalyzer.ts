/**
 * Funnel Analyzer
 * 
 * Provides funnel-aware campaign analysis with stage-appropriate metrics.
 * Awareness campaigns are judged on reach/CPM, conversion campaigns on ROAS.
 * 
 * Part of AI Marketing Co-Pilot Phase 3.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { AdsService } from '../../ads';
import { CampaignInsight } from '../../ads/types';
import { getCampaignType, getExpectedRoasThreshold, isBrandCampaign, CampaignType } from '../AdContext';

// =============================================================================
// TYPES
// =============================================================================

export type FunnelStage = 'awareness' | 'consideration' | 'conversion' | 'retention';

export interface FunnelStageMetrics {
    primaryMetric: string;
    secondaryMetric: string;
    benchmarks: {
        metric: string;
        good: number;
        warning: number;
        description: string;
    }[];
}

export interface CampaignFunnelAnalysis {
    campaignId: string;
    campaignName: string;
    platform: 'google' | 'meta';
    funnelStage: FunnelStage;
    campaignType: CampaignType;

    // Raw metrics
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;

    // Calculated metrics
    roas: number;
    cpm: number;
    ctr: number;
    cpc: number;
    cpa: number;

    // Funnel-aware assessment
    performance: 'excellent' | 'good' | 'fair' | 'poor';
    primaryMetricValue: number;
    primaryMetricAssessment: string;
    issues: string[];
    recommendations: string[];
}

export interface FunnelAnalysis {
    hasData: boolean;

    // Campaign breakdown by funnel stage
    byStageSummary: {
        stage: FunnelStage;
        campaigns: number;
        spend: number;
        spendShare: number;
        avgPerformance: number;
    }[];

    // Individual campaign analysis
    campaigns: CampaignFunnelAnalysis[];

    // Funnel health metrics
    funnelHealth: {
        hasAwareness: boolean;
        hasConsideration: boolean;
        hasConversion: boolean;
        balance: 'healthy' | 'top-heavy' | 'bottom-heavy' | 'unbalanced';
        recommendation: string;
    };

    // Mis-judged campaigns (judged on wrong metrics)
    misjudgedCampaigns: {
        campaignName: string;
        issue: string;
        correctMetric: string;
    }[];

    suggestions: string[];
}

// =============================================================================
// FUNNEL STAGE DEFINITIONS
// =============================================================================

const FUNNEL_STAGE_METRICS: Record<FunnelStage, FunnelStageMetrics> = {
    awareness: {
        primaryMetric: 'cpm',
        secondaryMetric: 'reach',
        benchmarks: [
            { metric: 'cpm', good: 15, warning: 30, description: 'Cost per 1000 impressions' },
            { metric: 'ctr', good: 0.5, warning: 0.2, description: 'Click-through rate %' },
            { metric: 'frequency', good: 2, warning: 5, description: 'Avg times shown per user' }
        ]
    },
    consideration: {
        primaryMetric: 'cpc',
        secondaryMetric: 'ctr',
        benchmarks: [
            { metric: 'cpc', good: 1.5, warning: 3, description: 'Cost per click' },
            { metric: 'ctr', good: 2, warning: 0.8, description: 'Click-through rate %' },
            { metric: 'engagement_rate', good: 5, warning: 2, description: 'Engagement rate %' }
        ]
    },
    conversion: {
        primaryMetric: 'roas',
        secondaryMetric: 'cpa',
        benchmarks: [
            { metric: 'roas', good: 3, warning: 1.5, description: 'Return on ad spend' },
            { metric: 'cpa', good: 30, warning: 60, description: 'Cost per acquisition' },
            { metric: 'conversion_rate', good: 3, warning: 1, description: 'Conversion rate %' }
        ]
    },
    retention: {
        primaryMetric: 'roas',
        secondaryMetric: 'cpa',
        benchmarks: [
            { metric: 'roas', good: 5, warning: 2, description: 'Return on ad spend (remarketing)' },
            { metric: 'cpa', good: 20, warning: 40, description: 'Cost per re-acquisition' },
            { metric: 'frequency', good: 3, warning: 8, description: 'Frequency cap adherence' }
        ]
    }
};

// =============================================================================
// HELPERS
// =============================================================================

function mapCampaignTypeToFunnelStage(type: CampaignType): FunnelStage {
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
            return 'consideration'; // Default to middle funnel
    }
}

function assessPerformance(
    campaign: CampaignFunnelAnalysis,
    stageMetrics: FunnelStageMetrics
): 'excellent' | 'good' | 'fair' | 'poor' {
    const primary = stageMetrics.primaryMetric;
    let value: number;

    switch (primary) {
        case 'roas':
            value = campaign.roas;
            break;
        case 'cpm':
            value = campaign.cpm;
            break;
        case 'cpc':
            value = campaign.cpc;
            break;
        case 'cpa':
            value = campaign.cpa;
            break;
        default:
            value = campaign.roas;
    }

    const benchmark = stageMetrics.benchmarks.find(b => b.metric === primary);
    if (!benchmark) return 'fair';

    // For metrics where lower is better (cpm, cpc, cpa)
    if (['cpm', 'cpc', 'cpa'].includes(primary)) {
        if (value <= benchmark.good) return 'excellent';
        if (value <= benchmark.good * 1.5) return 'good';
        if (value <= benchmark.warning) return 'fair';
        return 'poor';
    }

    // For metrics where higher is better (roas, ctr)
    if (value >= benchmark.good * 1.5) return 'excellent';
    if (value >= benchmark.good) return 'good';
    if (value >= benchmark.warning) return 'fair';
    return 'poor';
}

// =============================================================================
// MAIN ANALYZER
// =============================================================================

export class FunnelAnalyzer {

    /**
     * Analyze campaigns with funnel-stage awareness.
     */
    static async analyze(accountId: string, days: number = 30): Promise<FunnelAnalysis> {
        const result: FunnelAnalysis = {
            hasData: false,
            byStageSummary: [],
            campaigns: [],
            funnelHealth: {
                hasAwareness: false,
                hasConsideration: false,
                hasConversion: false,
                balance: 'unbalanced',
                recommendation: ''
            },
            misjudgedCampaigns: [],
            suggestions: []
        };

        try {
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId },
                select: { id: true, platform: true, name: true }
            });

            if (adAccounts.length === 0) return result;

            const allCampaigns: CampaignFunnelAnalysis[] = [];

            for (const adAccount of adAccounts) {
                try {
                    let campaigns: CampaignInsight[] = [];
                    const platform = adAccount.platform.toLowerCase() as 'google' | 'meta';

                    if (platform === 'google') {
                        campaigns = await AdsService.getGoogleCampaignInsights(adAccount.id, days);
                    } else if (platform === 'meta') {
                        campaigns = await AdsService.getMetaCampaignInsights(adAccount.id, days);
                    }

                    for (const campaign of campaigns) {
                        const campaignType = getCampaignType(campaign.campaignName);
                        const funnelStage = mapCampaignTypeToFunnelStage(campaignType);
                        const stageMetrics = FUNNEL_STAGE_METRICS[funnelStage];

                        const analysis: CampaignFunnelAnalysis = {
                            campaignId: campaign.campaignId,
                            campaignName: campaign.campaignName,
                            platform,
                            funnelStage,
                            campaignType,
                            spend: campaign.spend,
                            impressions: campaign.impressions,
                            clicks: campaign.clicks,
                            conversions: campaign.conversions,
                            revenue: campaign.conversionsValue,
                            roas: campaign.roas,
                            cpm: campaign.impressions > 0 ? (campaign.spend / campaign.impressions) * 1000 : 0,
                            ctr: campaign.ctr,
                            cpc: campaign.cpc,
                            cpa: campaign.cpa,
                            performance: 'fair',
                            primaryMetricValue: 0,
                            primaryMetricAssessment: '',
                            issues: [],
                            recommendations: []
                        };

                        // Set primary metric value
                        switch (stageMetrics.primaryMetric) {
                            case 'roas': analysis.primaryMetricValue = analysis.roas; break;
                            case 'cpm': analysis.primaryMetricValue = analysis.cpm; break;
                            case 'cpc': analysis.primaryMetricValue = analysis.cpc; break;
                            case 'cpa': analysis.primaryMetricValue = analysis.cpa; break;
                        }

                        // Assess performance
                        analysis.performance = assessPerformance(analysis, stageMetrics);
                        analysis.primaryMetricAssessment = `${stageMetrics.primaryMetric.toUpperCase()}: ${analysis.primaryMetricValue.toFixed(2)} (${analysis.performance})`;

                        // Identify issues
                        this.identifyIssues(analysis, stageMetrics);

                        allCampaigns.push(analysis);
                    }
                } catch (error) {
                    Logger.warn(`Failed to analyze campaigns for ${adAccount.id}`, { error });
                }
            }

            if (allCampaigns.length === 0) return result;

            result.campaigns = allCampaigns;
            result.hasData = true;

            // Calculate stage summaries
            this.calculateStageSummaries(result);

            // Assess funnel health
            this.assessFunnelHealth(result);

            // Identify misjudged campaigns
            this.identifyMisjudgedCampaigns(result);

            // Generate suggestions
            this.generateSuggestions(result);

        } catch (error) {
            Logger.error('FunnelAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /**
     * Identify issues for a campaign based on its funnel stage.
     */
    private static identifyIssues(
        campaign: CampaignFunnelAnalysis,
        stageMetrics: FunnelStageMetrics
    ): void {
        const { funnelStage, roas, cpm, ctr, cpa, spend, conversions } = campaign;

        if (funnelStage === 'awareness') {
            // Awareness: don't judge on ROAS, focus on reach efficiency
            if (cpm > 25) {
                campaign.issues.push(`High CPM ($${cpm.toFixed(2)}) - consider audience refinement`);
            }
            if (ctr < 0.3 && spend > 100) {
                campaign.issues.push(`Low CTR (${ctr.toFixed(2)}%) - creative may need refresh`);
            }
        } else if (funnelStage === 'consideration') {
            // Consideration: focus on engagement, not conversions
            if (ctr < 1 && spend > 100) {
                campaign.issues.push(`Low CTR (${ctr.toFixed(2)}%) for consideration stage`);
            }
        } else if (funnelStage === 'conversion' || funnelStage === 'retention') {
            // Conversion: ROAS matters
            const expectedThreshold = getExpectedRoasThreshold(campaign.campaignType);
            const minRoas = expectedThreshold?.min || 1.5;

            if (roas < minRoas && spend > 50) {
                campaign.issues.push(`ROAS (${roas.toFixed(2)}x) below threshold (${minRoas}x) for ${campaign.campaignType}`);
            }
            if (conversions === 0 && spend > 100) {
                campaign.issues.push(`No conversions with $${spend.toFixed(0)} spend - check conversion tracking`);
            }
        }
    }

    /**
     * Calculate aggregate metrics by funnel stage.
     */
    private static calculateStageSummaries(result: FunnelAnalysis): void {
        const stages: FunnelStage[] = ['awareness', 'consideration', 'conversion', 'retention'];
        const totalSpend = result.campaigns.reduce((sum, c) => sum + c.spend, 0);

        for (const stage of stages) {
            const stageCampaigns = result.campaigns.filter(c => c.funnelStage === stage);
            if (stageCampaigns.length === 0) continue;

            const stageSpend = stageCampaigns.reduce((sum, c) => sum + c.spend, 0);
            const perfScores = { excellent: 4, good: 3, fair: 2, poor: 1 };
            const avgPerf = stageCampaigns.reduce((sum, c) => sum + perfScores[c.performance], 0) / stageCampaigns.length;

            result.byStageSummary.push({
                stage,
                campaigns: stageCampaigns.length,
                spend: Math.round(stageSpend * 100) / 100,
                spendShare: totalSpend > 0 ? Math.round((stageSpend / totalSpend) * 1000) / 10 : 0,
                avgPerformance: Math.round(avgPerf * 10) / 10
            });
        }
    }

    /**
     * Assess overall funnel health and balance.
     */
    private static assessFunnelHealth(result: FunnelAnalysis): void {
        const stages = result.byStageSummary;
        const awareness = stages.find(s => s.stage === 'awareness');
        const consideration = stages.find(s => s.stage === 'consideration');
        const conversion = stages.find(s => s.stage === 'conversion' || s.stage === 'retention');

        result.funnelHealth.hasAwareness = !!awareness && awareness.spend > 0;
        result.funnelHealth.hasConsideration = !!consideration && consideration.spend > 0;
        result.funnelHealth.hasConversion = !!conversion && conversion.spend > 0;

        const awarenessShare = awareness?.spendShare || 0;
        const conversionShare = (conversion?.spendShare || 0) +
            (stages.find(s => s.stage === 'retention')?.spendShare || 0);

        if (awarenessShare > 50 && conversionShare < 20) {
            result.funnelHealth.balance = 'top-heavy';
            result.funnelHealth.recommendation = 'Heavy awareness spend but limited conversion focus. Consider adding more bottom-funnel campaigns.';
        } else if (conversionShare > 80 && awarenessShare < 10) {
            result.funnelHealth.balance = 'bottom-heavy';
            result.funnelHealth.recommendation = 'Mostly conversion-focused. Consider awareness campaigns to grow your audience pool.';
        } else if (awarenessShare > 15 && conversionShare > 30) {
            result.funnelHealth.balance = 'healthy';
            result.funnelHealth.recommendation = 'Good balance across funnel stages.';
        } else {
            result.funnelHealth.balance = 'unbalanced';
            result.funnelHealth.recommendation = 'Review campaign mix to ensure coverage across customer journey stages.';
        }
    }

    /**
     * Identify campaigns being judged on wrong metrics.
     */
    private static identifyMisjudgedCampaigns(result: FunnelAnalysis): void {
        for (const campaign of result.campaigns) {
            // Awareness campaign with high spend and low ROAS - but that's expected!
            if (campaign.funnelStage === 'awareness' && campaign.roas < 1 && campaign.spend > 200) {
                // Check if CPM is actually good
                if (campaign.cpm < 20) {
                    result.misjudgedCampaigns.push({
                        campaignName: campaign.campaignName,
                        issue: 'ROAS appears low, but this is an awareness campaign',
                        correctMetric: `CPM: $${campaign.cpm.toFixed(2)} (good for awareness)`
                    });
                }
            }

            // Prospecting campaign judged on immediate ROAS
            if (campaign.campaignType === 'prospecting' && campaign.roas < 2 && campaign.spend > 100) {
                if (campaign.ctr > 1) {
                    result.misjudgedCampaigns.push({
                        campaignName: campaign.campaignName,
                        issue: 'Prospecting campaigns have delayed ROAS - they fill the funnel',
                        correctMetric: `CTR: ${campaign.ctr.toFixed(2)}% (indicates interest)`
                    });
                }
            }
        }
    }

    /**
     * Generate funnel-aware suggestions.
     */
    private static generateSuggestions(result: FunnelAnalysis): void {
        const { funnelHealth, campaigns, byStageSummary, misjudgedCampaigns } = result;

        // Funnel balance suggestion
        if (funnelHealth.balance !== 'healthy') {
            result.suggestions.push(
                `🎯 **Funnel Balance**: ${funnelHealth.recommendation}`
            );
        }

        // Poor performing campaigns by stage
        const poorCampaigns = campaigns.filter(c => c.performance === 'poor' && c.spend > 100);
        if (poorCampaigns.length > 0) {
            const byStage = new Map<FunnelStage, number>();
            for (const c of poorCampaigns) {
                byStage.set(c.funnelStage, (byStage.get(c.funnelStage) || 0) + 1);
            }

            for (const [stage, count] of byStage.entries()) {
                result.suggestions.push(
                    `⚠️ **${stage.charAt(0).toUpperCase() + stage.slice(1)} Issues**: ${count} campaigns underperforming. Review targeting and creative.`
                );
            }
        }

        // Misjudged campaign alert
        if (misjudgedCampaigns.length > 0) {
            result.suggestions.push(
                `💡 **Metric Context**: ${misjudgedCampaigns.length} campaign(s) may appear underperforming but are serving their funnel purpose. ` +
                `Example: "${misjudgedCampaigns[0].campaignName}" - ${misjudgedCampaigns[0].issue}`
            );
        }

        // No awareness campaigns warning
        if (!funnelHealth.hasAwareness && byStageSummary.length > 0) {
            result.suggestions.push(
                `📢 **No Awareness Campaigns**: You're only running conversion campaigns. ` +
                `Consider adding awareness/video campaigns to expand your audience pool.`
            );
        }

        // High performing campaigns
        const excellentCampaigns = campaigns.filter(c => c.performance === 'excellent' && c.spend > 50);
        if (excellentCampaigns.length > 0) {
            const best = excellentCampaigns.sort((a, b) => b.spend - a.spend)[0];
            result.suggestions.push(
                `🌟 **Top Performer**: "${best.campaignName}" is excellent at ${best.funnelStage} stage ` +
                `(${best.primaryMetricAssessment}). Consider scaling budget.`
            );
        }
    }
}
