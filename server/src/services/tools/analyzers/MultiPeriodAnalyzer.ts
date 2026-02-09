/**
 * Multi-Period Analyzer
 * 
 * Fetches and compares ad performance across multiple time periods (7d, 30d, 90d)
 * to detect trends, anomalies, and provide data-backed recommendations.
 * 
 * Part of AI Marketing Co-Pilot Phase 1.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { AdsService } from '../../ads';
import { PeriodMetrics, testRoasChange, calculateAnomalyScore, ConfidenceResult } from '../utils/StatisticalUtils';
import { ActionableRecommendation, BudgetAction, createBudgetHeadline } from '../types/ActionableTypes';


export interface MultiPeriodData {
    platform: 'google' | 'meta';
    adAccountId: string;
    adAccountName: string;
    periods: {
        '7d': PeriodMetrics;
        '30d': PeriodMetrics;
        '90d': PeriodMetrics;
    };
}

export interface MultiPeriodAnalysis {
    hasData: boolean;
    google?: MultiPeriodData;
    meta?: MultiPeriodData;
    combined: {
        '7d': PeriodMetrics;
        '30d': PeriodMetrics;
        '90d': PeriodMetrics;
    };
    trends: {
        roas_7d_vs_30d: { change: number; confidence: ConfidenceResult };
        roas_30d_vs_90d: { change: number; confidence: ConfidenceResult };
        spend_trajectory: 'increasing' | 'stable' | 'decreasing';
        performance_trajectory: 'improving' | 'stable' | 'declining';
    };
    anomalies: Array<{
        metric: string;
        period: string;
        severity: 'warning' | 'critical';
        message: string;
    }>;
    suggestions: string[];
    actionableRecommendations: ActionableRecommendation[];
}


function emptyMetrics(): PeriodMetrics {
    return {
        spend: 0,
        revenue: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        roas: 0,
        ctr: 0,
        cpc: 0,
        cpa: 0
    };
}

function aggregateMetrics(dailyData: any[]): PeriodMetrics {
    const totals = dailyData.reduce((acc, day) => ({
        spend: acc.spend + (day.spend || 0),
        revenue: acc.revenue + (day.conversionsValue || day.revenue || 0),
        clicks: acc.clicks + (day.clicks || 0),
        impressions: acc.impressions + (day.impressions || 0),
        conversions: acc.conversions + (day.conversions || 0)
    }), { spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0 });

    return {
        ...totals,
        roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
        ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
        cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
        cpa: totals.conversions > 0 ? totals.spend / totals.conversions : 0
    };
}

function combineMetrics(a: PeriodMetrics, b: PeriodMetrics): PeriodMetrics {
    const combined = {
        spend: a.spend + b.spend,
        revenue: a.revenue + b.revenue,
        clicks: a.clicks + b.clicks,
        impressions: a.impressions + b.impressions,
        conversions: a.conversions + b.conversions,
        roas: 0,
        ctr: 0,
        cpc: 0,
        cpa: 0
    };

    combined.roas = combined.spend > 0 ? combined.revenue / combined.spend : 0;
    combined.ctr = combined.impressions > 0 ? (combined.clicks / combined.impressions) * 100 : 0;
    combined.cpc = combined.clicks > 0 ? combined.spend / combined.clicks : 0;
    combined.cpa = combined.conversions > 0 ? combined.spend / combined.conversions : 0;

    return combined;
}

function determineTrajectory(values: number[]): 'increasing' | 'stable' | 'decreasing' {
    if (values.length < 2) return 'stable';

    // Simple linear regression slope
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
        numerator += (i - xMean) * (values[i] - yMean);
        denominator += (i - xMean) * (i - xMean);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const relativeSlope = yMean !== 0 ? slope / yMean : 0;

    if (relativeSlope > 0.05) return 'increasing';
    if (relativeSlope < -0.05) return 'decreasing';
    return 'stable';
}


export class MultiPeriodAnalyzer {

    /**
     * Fetch and analyze ad performance across 7d, 30d, and 90d periods.
     */
    static async analyze(accountId: string): Promise<MultiPeriodAnalysis> {
        const result: MultiPeriodAnalysis = {
            hasData: false,
            combined: {
                '7d': emptyMetrics(),
                '30d': emptyMetrics(),
                '90d': emptyMetrics()
            },
            trends: {
                roas_7d_vs_30d: { change: 0, confidence: { isSignificant: false, confidence: 'low', score: 0, sampleSize: 0, factors: [] } },
                roas_30d_vs_90d: { change: 0, confidence: { isSignificant: false, confidence: 'low', score: 0, sampleSize: 0, factors: [] } },
                spend_trajectory: 'stable',
                performance_trajectory: 'stable'
            },
            anomalies: [],
            suggestions: [],
            actionableRecommendations: []
        };

        try {
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId },
                select: { id: true, platform: true, name: true, externalId: true }
            });

            if (adAccounts.length === 0) {
                return result;
            }

            // Fetch data for each platform
            const googleAccounts = adAccounts.filter(a => a.platform === 'GOOGLE');
            const metaAccounts = adAccounts.filter(a => a.platform === 'META');

            const [googleData, metaData] = await Promise.all([
                this.fetchPlatformData(googleAccounts, 'google'),
                this.fetchPlatformData(metaAccounts, 'meta')
            ]);

            if (googleData) {
                result.google = googleData;
                result.hasData = true;
            }
            if (metaData) {
                result.meta = metaData;
                result.hasData = true;
            }

            if (!result.hasData) {
                return result;
            }

            // Combine metrics across platforms
            result.combined = {
                '7d': combineMetrics(
                    result.google?.periods['7d'] || emptyMetrics(),
                    result.meta?.periods['7d'] || emptyMetrics()
                ),
                '30d': combineMetrics(
                    result.google?.periods['30d'] || emptyMetrics(),
                    result.meta?.periods['30d'] || emptyMetrics()
                ),
                '90d': combineMetrics(
                    result.google?.periods['90d'] || emptyMetrics(),
                    result.meta?.periods['90d'] || emptyMetrics()
                )
            };

            // Calculate trends
            this.calculateTrends(result);

            // Detect anomalies
            this.detectAnomalies(result);

            // Generate suggestions
            this.generateSuggestions(result);

        } catch (error) {
            Logger.error('MultiPeriodAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /**
     * Fetch multi-period data for a specific platform.
     */
    private static async fetchPlatformData(
        accounts: Array<{ id: string; platform: string; name: string | null; externalId: string | null }>,
        platform: 'google' | 'meta'
    ): Promise<MultiPeriodData | null> {
        if (accounts.length === 0) return null;

        const periods: { '7d': PeriodMetrics; '30d': PeriodMetrics; '90d': PeriodMetrics } = {
            '7d': emptyMetrics(),
            '30d': emptyMetrics(),
            '90d': emptyMetrics()
        };

        for (const account of accounts) {
            try {
                // Fetch daily trends for different periods
                const dailyData90 = platform === 'google'
                    ? await AdsService.getGoogleDailyTrends(account.id, 90)
                    : await AdsService.getMetaDailyTrends(account.id, 90);

                if (dailyData90.length === 0) continue;

                // Split into periods
                const last7 = dailyData90.slice(-7);
                const last30 = dailyData90.slice(-30);
                const all90 = dailyData90;

                // Aggregate each period
                const metrics7 = aggregateMetrics(last7);
                const metrics30 = aggregateMetrics(last30);
                const metrics90 = aggregateMetrics(all90);

                // Combine with existing (for multi-account)
                periods['7d'] = combineMetrics(periods['7d'], metrics7);
                periods['30d'] = combineMetrics(periods['30d'], metrics30);
                periods['90d'] = combineMetrics(periods['90d'], metrics90);

            } catch (error) {
                Logger.warn(`Failed to fetch ${platform} data for account ${account.id}`, { error });
            }
        }

        // Check if we got any data
        if (periods['30d'].spend === 0) return null;

        return {
            platform,
            adAccountId: accounts[0].id,
            adAccountName: accounts[0].name || accounts[0].externalId || 'Unknown',
            periods
        };
    }

    /**
     * Calculate trend metrics and confidence levels.
     */
    private static calculateTrends(result: MultiPeriodAnalysis): void {
        const { combined } = result;

        // ROAS 7d vs 30d
        const roas7 = combined['7d'].roas;
        const roas30 = combined['30d'].roas;
        const roasChange7v30 = roas30 > 0 ? ((roas7 - roas30) / roas30) * 100 : 0;

        result.trends.roas_7d_vs_30d = {
            change: roasChange7v30,
            confidence: testRoasChange(combined['30d'], combined['7d'])
        };

        // ROAS 30d vs 90d
        const roas90 = combined['90d'].roas;
        const roasChange30v90 = roas90 > 0 ? ((roas30 - roas90) / roas90) * 100 : 0;

        result.trends.roas_30d_vs_90d = {
            change: roasChange30v90,
            confidence: testRoasChange(combined['90d'], combined['30d'])
        };

        // Spend trajectory (are we scaling up or down?)
        const spendValues = [
            combined['90d'].spend / 90,  // Daily avg 90d
            combined['30d'].spend / 30,  // Daily avg 30d
            combined['7d'].spend / 7     // Daily avg 7d
        ];
        result.trends.spend_trajectory = determineTrajectory(spendValues);

        // Performance trajectory (is ROAS improving?)
        const roasValues = [roas90, roas30, roas7];
        const perfTrajectory = determineTrajectory(roasValues);
        result.trends.performance_trajectory =
            perfTrajectory === 'increasing' ? 'improving' :
                perfTrajectory === 'decreasing' ? 'declining' : 'stable';
    }

    /**
     * Detect anomalous metrics that need attention.
     */
    private static detectAnomalies(result: MultiPeriodAnalysis): void {
        const { combined } = result;

        // Check for ROAS crash
        if (combined['30d'].roas > 0 && combined['7d'].roas < combined['30d'].roas * 0.5) {
            result.anomalies.push({
                metric: 'roas',
                period: '7d',
                severity: 'critical',
                message: `ROAS crashed from ${combined['30d'].roas.toFixed(2)}x (30d avg) to ${combined['7d'].roas.toFixed(2)}x (last 7d) - 50%+ drop`
            });
        }

        // Check for CTR decline
        if (combined['30d'].ctr > 0 && combined['7d'].ctr < combined['30d'].ctr * 0.7) {
            result.anomalies.push({
                metric: 'ctr',
                period: '7d',
                severity: 'warning',
                message: `CTR dropped from ${combined['30d'].ctr.toFixed(2)}% to ${combined['7d'].ctr.toFixed(2)}% - possible creative fatigue`
            });
        }

        // Check for CPA spike
        if (combined['30d'].cpa > 0 && combined['7d'].cpa > combined['30d'].cpa * 1.5) {
            result.anomalies.push({
                metric: 'cpa',
                period: '7d',
                severity: 'warning',
                message: `CPA spiked from $${combined['30d'].cpa.toFixed(2)} to $${combined['7d'].cpa.toFixed(2)} - acquisition cost up 50%+`
            });
        }

        // Check for spend drop (might indicate budget issues)
        const dailySpend7 = combined['7d'].spend / 7;
        const dailySpend30 = combined['30d'].spend / 30;
        if (dailySpend30 > 10 && dailySpend7 < dailySpend30 * 0.5) {
            result.anomalies.push({
                metric: 'spend',
                period: '7d',
                severity: 'warning',
                message: `Daily spend dropped from $${dailySpend30.toFixed(0)} to $${dailySpend7.toFixed(0)} - check budget limits or ad disapprovals`
            });
        }
    }

    /**
     * Generate actionable suggestions based on analysis.
     */
    private static generateSuggestions(result: MultiPeriodAnalysis): void {
        const { trends, anomalies, combined } = result;

        // Priority 1: Address critical anomalies
        for (const anomaly of anomalies.filter(a => a.severity === 'critical')) {
            result.suggestions.push(`🚨 **Critical**: ${anomaly.message}`);
        }

        // Priority 2: Performance trajectory insights
        if (trends.performance_trajectory === 'declining' && trends.roas_7d_vs_30d.confidence.score >= 60) {
            result.suggestions.push(
                `📉 **Performance Declining**: ROAS is ${Math.abs(trends.roas_7d_vs_30d.change).toFixed(0)}% lower this week vs monthly average ` +
                `(${combined['7d'].roas.toFixed(2)}x vs ${combined['30d'].roas.toFixed(2)}x). ` +
                `Confidence: ${trends.roas_7d_vs_30d.confidence.confidence}.`
            );
        } else if (trends.performance_trajectory === 'improving' && trends.roas_7d_vs_30d.confidence.score >= 60) {
            result.suggestions.push(
                `📈 **Performance Improving**: ROAS is up ${trends.roas_7d_vs_30d.change.toFixed(0)}% this week vs monthly average ` +
                `(${combined['7d'].roas.toFixed(2)}x vs ${combined['30d'].roas.toFixed(2)}x). ` +
                `Consider scaling budget on top performers.`
            );

            // Add actionable recommendation
            const currentDailySpend = combined['7d'].spend / 7;
            const increaseAmount = Math.max(5, Math.round((currentDailySpend * 0.2) / 5) * 5); // 20% increase, rounded to $5
            const newBudget = currentDailySpend + increaseAmount;

            const action: BudgetAction = {
                actionType: 'budget_increase',
                campaignId: result.google?.adAccountId || result.meta?.adAccountId || 'all_campaigns',
                campaignName: 'Top Performing Campaigns', // Ideally would identify specific campaign
                platform: result.google ? 'google' : 'meta',
                currentBudget: currentDailySpend,
                suggestedBudget: newBudget,
                changeAmount: increaseAmount,
                changePercent: 20,
                reason: 'performance_improving'
            };

            result.actionableRecommendations.push({
                id: 'budget_scaling_opportunity',
                priority: 2,
                category: 'budget',
                headline: `📈 ${createBudgetHeadline(action)}`,
                explanation: `ROAS is up ${trends.roas_7d_vs_30d.change.toFixed(0)}% this week (${combined['7d'].roas.toFixed(2)}x). ` +
                    `Scaling budget by 20% can capture more high-value conversions.`,
                dataPoints: [
                    `Current 7d ROAS: ${combined['7d'].roas.toFixed(2)}x`,
                    `Previous 30d ROAS: ${combined['30d'].roas.toFixed(2)}x`,
                    `Current Daily Spend: $${currentDailySpend.toFixed(0)}`
                ],
                action,
                confidence: 75,
                estimatedImpact: {
                    revenueChange: combined['7d'].revenue / 7 * 0.2, // Est 20% revenue lift
                    spendChange: increaseAmount,
                    timeframe: '7d'
                },
                platform: result.google ? 'google' : 'meta', // Simplified
                source: 'MultiPeriodAnalyzer',
                tags: ['budget', 'scaling', 'performance']
            });

        }

        // Priority 3: Spend trajectory + performance cross-analysis
        if (trends.spend_trajectory === 'increasing' && trends.performance_trajectory === 'declining') {
            result.suggestions.push(
                `⚠️ **Scaling Warning**: Spend is increasing but performance is declining. ` +
                `You may be hitting diminishing returns. Review audience expansion and bidding strategy.`
            );

            // Add actionable recommendation to pull back
            const currentDailySpend = combined['7d'].spend / 7;
            const decreaseAmount = Math.max(5, Math.round((currentDailySpend * 0.15) / 5) * 5); // 15% decrease
            const newBudget = currentDailySpend - decreaseAmount;

            const action: BudgetAction = {
                actionType: 'budget_decrease',
                campaignId: result.google?.adAccountId || 'all_campaigns',
                campaignName: 'All Campaigns',
                platform: result.google ? 'google' : 'meta',
                currentBudget: currentDailySpend,
                suggestedBudget: newBudget,
                changeAmount: -decreaseAmount,
                changePercent: -15,
                reason: 'diminishing_returns'
            };

            result.actionableRecommendations.push({
                id: 'budget_pullback_warning',
                priority: 2,
                category: 'budget',
                headline: `⚠️ ${createBudgetHeadline(action)}`,
                explanation: `Spend increased but ROAS declined to ${combined['7d'].roas.toFixed(2)}x. ` +
                    `You may be hitting diminishing returns. Recommend pulling back budget by 15%.`,
                dataPoints: [
                    `Spend Trend: Increasing`,
                    `Performance: Declining`,
                    `Current ROAS: ${combined['7d'].roas.toFixed(2)}x`
                ],
                action,
                confidence: 70,
                platform: result.google ? 'google' : 'meta',
                source: 'MultiPeriodAnalyzer',
                tags: ['budget', 'efficiency', 'warning']
            });
        } else if (trends.spend_trajectory === 'decreasing' && trends.performance_trajectory === 'improving') {
            result.suggestions.push(
                `💡 **Opportunity**: Performance is improving while spend is decreasing. ` +
                `Consider cautiously increasing budget to capture additional conversions.`
            );
        }

        // Priority 4: Long-term vs short-term divergence
        if (Math.abs(trends.roas_7d_vs_30d.change) > 20 && Math.abs(trends.roas_30d_vs_90d.change) < 10) {
            const direction = trends.roas_7d_vs_30d.change > 0 ? 'spike' : 'dip';
            result.suggestions.push(
                `🔍 **Short-term ${direction}**: Recent 7-day performance differs significantly from trend. ` +
                `This may be a temporary fluctuation - monitor for 3-5 more days before major changes.`
            );
        }

        // Priority 5: Warning-level anomalies
        for (const anomaly of anomalies.filter(a => a.severity === 'warning')) {
            result.suggestions.push(`⚠️ ${anomaly.message}`);
        }
    }

    /**
     * Get a formatted summary string for quick display.
     */
    static formatSummary(analysis: MultiPeriodAnalysis): string {
        if (!analysis.hasData) {
            return 'No ad performance data available.';
        }

        const { combined, trends } = analysis;

        const lines = [
            `**7-Day Performance**: ${combined['7d'].roas.toFixed(2)}x ROAS, $${combined['7d'].spend.toFixed(0)} spend, ${combined['7d'].conversions.toFixed(0)} conversions`,
            `**30-Day Performance**: ${combined['30d'].roas.toFixed(2)}x ROAS, $${combined['30d'].spend.toFixed(0)} spend, ${combined['30d'].conversions.toFixed(0)} conversions`,
            `**Trend**: Performance is ${trends.performance_trajectory}, spend is ${trends.spend_trajectory}`
        ];

        if (analysis.anomalies.length > 0) {
            lines.push(`**Alerts**: ${analysis.anomalies.length} issue(s) detected`);
        }

        return lines.join('\n');
    }
}
