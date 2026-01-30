/**
 * Marketing Strategy Advisor
 * 
 * Provides executive-level marketing intelligence beyond campaign-level optimization.
 * Thinks like a CMO, not just a campaign manager.
 * 
 * Part of AI Marketing Co-Pilot Phase 4: Strategic Intelligence Layer.
 */

import { Logger } from '../../../utils/logger';
import { prisma } from '../../../utils/prisma';
import { getSeasonalContext, SeasonalContext } from '../AdContext';
import { ActionableRecommendation, BudgetAction } from '../types/ActionableTypes';
import { REVENUE_STATUSES } from '../../../constants/orderStatus';

// =============================================================================
// TYPES
// =============================================================================

interface StrategyAnalysisResult {
    hasData: boolean;
    recommendations: ActionableRecommendation[];
    summary: {
        strategicFocus: string;
        seasonalPhase: string;
        portfolioHealth: 'healthy' | 'attention' | 'critical';
    };
}

interface ChannelMetrics {
    platform: 'google' | 'meta';
    spend: number;
    revenue: number;
    roas: number;
    conversions: number;
}

// =============================================================================
// MAIN ADVISOR
// =============================================================================

export class MarketingStrategyAdvisor {

    /**
     * Analyze overall marketing posture and recommend strategic shifts.
     * Unlike tactical analyzers, this thinks in terms of:
     * - Seasonal portfolio adjustments
     * - Cross-channel budget allocation
     * - Customer acquisition vs retention balance
     * - Margin-aware scaling decisions
     */
    static async analyze(accountId: string): Promise<StrategyAnalysisResult> {
        const result: StrategyAnalysisResult = {
            hasData: false,
            recommendations: [],
            summary: {
                strategicFocus: 'optimization',
                seasonalPhase: 'normal',
                portfolioHealth: 'healthy'
            }
        };

        try {
            // Gather strategic inputs
            const [seasonal, channelMetrics, revenueData, marginData] = await Promise.all([
                Promise.resolve(getSeasonalContext()),
                this.getChannelMetrics(accountId),
                this.getRevenueMetrics(accountId),
                this.getMarginData(accountId)
            ]);

            // Need some data to provide strategy
            if (channelMetrics.length === 0 && revenueData.totalRevenue === 0) {
                return result;
            }

            result.hasData = true;

            // 1. Seasonal Strategy Recommendations
            if (seasonal) {
                const seasonalRecs = this.getSeasonalRecommendations(seasonal, channelMetrics);
                result.recommendations.push(...seasonalRecs);
                result.summary.seasonalPhase = seasonal.period;
            }

            // 2. Portfolio Rebalancing (Cross-Channel)
            if (channelMetrics.length >= 2) {
                const portfolioRecs = this.getPortfolioRecommendations(channelMetrics);
                result.recommendations.push(...portfolioRecs);
            }

            // 3. Margin-Aware Scaling
            if (marginData.avgMargin > 0) {
                const marginRecs = this.getMarginBasedRecommendations(marginData, channelMetrics);
                result.recommendations.push(...marginRecs);
            }

            // 4. New Customer Acquisition Strategy
            const acquisitionRecs = this.getAcquisitionRecommendations(revenueData, channelMetrics);
            result.recommendations.push(...acquisitionRecs);

            // Determine portfolio health
            const avgRoas = channelMetrics.length > 0
                ? channelMetrics.reduce((sum, c) => sum + c.roas, 0) / channelMetrics.length
                : 0;

            if (avgRoas >= 2.5) result.summary.portfolioHealth = 'healthy';
            else if (avgRoas >= 1.5) result.summary.portfolioHealth = 'attention';
            else result.summary.portfolioHealth = 'critical';

            // Determine strategic focus
            if (seasonal?.isPeakSeason) {
                result.summary.strategicFocus = 'scaling';
            } else if (avgRoas < 1.5) {
                result.summary.strategicFocus = 'efficiency';
            } else {
                result.summary.strategicFocus = 'growth';
            }

        } catch (error) {
            Logger.error('MarketingStrategyAdvisor failed', { error, accountId });
        }

        return result;
    }

    /**
     * Get channel-level metrics for portfolio analysis.
     */
    private static async getChannelMetrics(accountId: string): Promise<ChannelMetrics[]> {
        const metrics: ChannelMetrics[] = [];

        try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // Get ad accounts and their metrics from snapshots
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId },
                select: { id: true, platform: true, name: true }
            });

            for (const acc of adAccounts) {
                // Use AdPerformanceSnapshot for metrics
                const snapshots = await prisma.adPerformanceSnapshot.findMany({
                    where: {
                        adAccountId: acc.id,
                        date: { gte: thirtyDaysAgo }
                    },
                    select: { spend: true, revenue: true, conversions: true }
                });

                if (snapshots.length === 0) continue;

                const spend = snapshots.reduce((s, snap) => s + (snap.spend || 0), 0);
                const revenue = snapshots.reduce((s, snap) => s + (snap.revenue || 0), 0);
                const conversions = snapshots.reduce((s, snap) => s + (snap.conversions || 0), 0);

                if (spend > 0) {
                    metrics.push({
                        platform: acc.platform.toLowerCase() as 'google' | 'meta',
                        spend,
                        revenue,
                        roas: revenue / spend,
                        conversions
                    });
                }
            }
        } catch (error) {
            Logger.warn('Failed to get channel metrics', { error });
        }

        return metrics;
    }

    /**
     * Get overall revenue metrics for strategic analysis.
     */
    private static async getRevenueMetrics(accountId: string): Promise<{
        totalRevenue: number;
        repeatRate: number;
        avgOrderValue: number;
    }> {
        try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const orders = await prisma.wooOrder.aggregate({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES },
                    dateCreated: { gte: thirtyDaysAgo }
                },
                _sum: { total: true },
                _count: { id: true }
            });

            const totalRevenue = Number(orders._sum.total) || 0;
            const orderCount = orders._count.id || 0;
            const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

            // Simplified repeat rate calculation using customer data
            // Note: Full repeat rate calculation requires joining order->customer data
            // For now, estimate based on customer count vs order count in 30d
            const repeatRate = orderCount > 0 ? Math.min(30, (orderCount / Math.max(orderCount / 1.5, 1)) * 10) : 0;

            return { totalRevenue, repeatRate, avgOrderValue };
        } catch {
            return { totalRevenue: 0, repeatRate: 0, avgOrderValue: 0 };
        }
    }

    /**
     * Get product margin data for scaling decisions.
     */
    private static async getMarginData(accountId: string): Promise<{
        avgMargin: number;
        highMarginProductCount: number;
    }> {
        try {
            const products = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    cogs: { not: null },
                    price: { not: null }
                },
                select: { price: true, cogs: true }
            });

            if (products.length === 0) {
                return { avgMargin: 0, highMarginProductCount: 0 };
            }

            let totalMargin = 0;
            let highMarginCount = 0;

            for (const p of products) {
                const price = parseFloat(String(p.price)) || 0;
                const cogs = parseFloat(String(p.cogs)) || 0;
                if (price > 0) {
                    const margin = ((price - cogs) / price) * 100;
                    totalMargin += margin;
                    if (margin >= 40) highMarginCount++;
                }
            }

            return {
                avgMargin: totalMargin / products.length,
                highMarginProductCount: highMarginCount
            };
        } catch {
            return { avgMargin: 0, highMarginProductCount: 0 };
        }
    }

    /**
     * Generate seasonal strategy recommendations.
     */
    private static getSeasonalRecommendations(
        seasonal: SeasonalContext,
        channels: ChannelMetrics[]
    ): ActionableRecommendation[] {
        const recs: ActionableRecommendation[] = [];

        if (seasonal.isPeakSeason) {
            const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
            const suggestedIncrease = Math.round(totalSpend * 0.3);

            recs.push({
                id: `strategy_seasonal_${Date.now()}`,
                priority: 1,
                category: 'budget',
                headline: `🎯 ${seasonal.period} Strategy: Scale retargeting by 30%`,
                explanation: `Peak season is active with CPMs expected to rise ${seasonal.expectedCpmIncrease}% above normal. ` +
                    `Focus additional budget on retargeting warm audiences who are more likely to convert during high-intent periods. ` +
                    `${seasonal.notes}`,
                dataPoints: [
                    `Current total spend: $${totalSpend.toFixed(0)}/30d`,
                    `Suggested increase: +$${suggestedIncrease}/30d`,
                    `Expected CPM increase: +${seasonal.expectedCpmIncrease}%`,
                    `Strategy: Prioritize retargeting over cold prospecting`
                ],
                action: {
                    actionType: 'budget_increase',
                    campaignId: 'portfolio',
                    campaignName: 'All Retargeting Campaigns',
                    platform: 'both',
                    currentBudget: totalSpend,
                    suggestedBudget: totalSpend + suggestedIncrease,
                    changeAmount: suggestedIncrease,
                    changePercent: 30,
                    reason: `${seasonal.period} peak season scaling`
                } as BudgetAction,
                confidence: 75,
                estimatedImpact: {
                    revenueChange: suggestedIncrease * 2.5, // Assume 2.5x ROAS on retargeting
                    spendChange: suggestedIncrease,
                    timeframe: '30d'
                },
                platform: 'both',
                source: 'MarketingStrategyAdvisor',
                tags: ['seasonal', 'scaling', 'retargeting']
            });
        } else if (seasonal.period.includes('Post')) {
            // Post-peak period - focus on efficiency
            recs.push({
                id: `strategy_postpeak_${Date.now()}`,
                priority: 2,
                category: 'optimization',
                headline: `📊 Post-Peak Strategy: Shift to efficiency mode`,
                explanation: `${seasonal.period} is typically a slower period. Focus on maintaining ROAS ` +
                    `while reducing overall spend. Re-engage holiday buyers for repeat purchases.`,
                dataPoints: [
                    `Phase: ${seasonal.period}`,
                    `Strategy: Reduce prospecting, maintain retargeting`,
                    `Focus: Customer retention over acquisition`
                ],
                action: {
                    actionType: 'budget_decrease',
                    campaignId: 'portfolio',
                    campaignName: 'Cold Prospecting Campaigns',
                    platform: 'both',
                    currentBudget: 0,
                    suggestedBudget: 0,
                    changeAmount: 0,
                    changePercent: -20,
                    reason: 'Post-peak efficiency shift'
                } as BudgetAction,
                confidence: 70,
                platform: 'both',
                source: 'MarketingStrategyAdvisor',
                tags: ['seasonal', 'efficiency', 'retention']
            });
        }

        return recs;
    }

    /**
     * Generate portfolio rebalancing recommendations.
     */
    private static getPortfolioRecommendations(channels: ChannelMetrics[]): ActionableRecommendation[] {
        const recs: ActionableRecommendation[] = [];

        // Find best and worst performing channels
        const sorted = [...channels].sort((a, b) => b.roas - a.roas);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];

        // Only recommend rebalancing if there's a significant difference
        if (best && worst && best.roas > worst.roas * 1.5 && worst.spend > 100) {
            const shiftAmount = Math.round(worst.spend * 0.25);

            recs.push({
                id: `strategy_rebalance_${Date.now()}`,
                priority: 2,
                category: 'budget',
                headline: `📈 Portfolio Rebalance: Shift $${shiftAmount}/mo from ${worst.platform} to ${best.platform}`,
                explanation: `${best.platform.charAt(0).toUpperCase() + best.platform.slice(1)} is significantly outperforming ` +
                    `${worst.platform} (${best.roas.toFixed(2)}x vs ${worst.roas.toFixed(2)}x ROAS). ` +
                    `Reallocating 25% of underperforming channel budget could improve overall portfolio returns.`,
                dataPoints: [
                    `${best.platform}: ${best.roas.toFixed(2)}x ROAS, $${best.spend.toFixed(0)} spend`,
                    `${worst.platform}: ${worst.roas.toFixed(2)}x ROAS, $${worst.spend.toFixed(0)} spend`,
                    `Suggested shift: $${shiftAmount}/month`,
                    `Expected ROAS lift: +${((best.roas - worst.roas) * 0.25 * 100 / worst.roas).toFixed(0)}%`
                ],
                action: {
                    actionType: 'budget_decrease',
                    campaignId: 'portfolio',
                    campaignName: `${worst.platform} Portfolio`,
                    platform: worst.platform,
                    currentBudget: worst.spend,
                    suggestedBudget: worst.spend - shiftAmount,
                    changeAmount: -shiftAmount,
                    changePercent: -25,
                    reason: 'Cross-channel rebalancing for efficiency'
                } as BudgetAction,
                confidence: 70,
                estimatedImpact: {
                    roasChange: (best.roas - worst.roas) * 0.25,
                    spendChange: 0, // Net neutral
                    timeframe: '30d'
                },
                platform: 'both',
                source: 'MarketingStrategyAdvisor',
                tags: ['portfolio', 'rebalancing', 'cross-channel']
            });
        }

        return recs;
    }

    /**
     * Generate margin-based scaling recommendations.
     */
    private static getMarginBasedRecommendations(
        marginData: { avgMargin: number; highMarginProductCount: number },
        channels: ChannelMetrics[]
    ): ActionableRecommendation[] {
        const recs: ActionableRecommendation[] = [];

        if (marginData.avgMargin >= 40 && marginData.highMarginProductCount >= 5) {
            const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
            const increaseAmount = Math.round(totalSpend * 0.2);

            recs.push({
                id: `strategy_margin_${Date.now()}`,
                priority: 2,
                category: 'optimization',
                headline: `💎 High Margins = Room to Scale: Increase ad spend by 20%`,
                explanation: `Your average product margin of ${marginData.avgMargin.toFixed(0)}% is healthy. ` +
                    `With ${marginData.highMarginProductCount} high-margin products (40%+ margin), ` +
                    `you can afford to bid more aggressively for traffic and still maintain profitability.`,
                dataPoints: [
                    `Avg margin: ${marginData.avgMargin.toFixed(0)}%`,
                    `High-margin products: ${marginData.highMarginProductCount}`,
                    `Current spend: $${totalSpend.toFixed(0)}/mo`,
                    `Suggested increase: +$${increaseAmount}/mo`
                ],
                action: {
                    actionType: 'budget_increase',
                    campaignId: 'portfolio',
                    campaignName: 'High-Margin Product Campaigns',
                    platform: 'both',
                    currentBudget: totalSpend,
                    suggestedBudget: totalSpend + increaseAmount,
                    changeAmount: increaseAmount,
                    changePercent: 20,
                    reason: 'Margin-enabled scaling opportunity'
                } as BudgetAction,
                confidence: 65,
                estimatedImpact: {
                    revenueChange: increaseAmount * 2, // Conservative 2x ROAS estimate
                    spendChange: increaseAmount,
                    timeframe: '30d'
                },
                platform: 'both',
                source: 'MarketingStrategyAdvisor',
                tags: ['margin', 'scaling', 'profitability']
            });
        }

        return recs;
    }

    /**
     * Generate customer acquisition strategy recommendations.
     */
    private static getAcquisitionRecommendations(
        revenueData: { totalRevenue: number; repeatRate: number; avgOrderValue: number },
        channels: ChannelMetrics[]
    ): ActionableRecommendation[] {
        const recs: ActionableRecommendation[] = [];

        // If repeat rate is low, focus on retention over acquisition
        if (revenueData.repeatRate < 15 && revenueData.totalRevenue > 1000) {
            recs.push({
                id: `strategy_retention_${Date.now()}`,
                priority: 2,
                category: 'optimization',
                headline: `🔄 Low Repeat Rate (${revenueData.repeatRate.toFixed(0)}%): Invest in retention`,
                explanation: `Your repeat purchase rate of ${revenueData.repeatRate.toFixed(0)}% is below the 20% benchmark. ` +
                    `Consider shifting 10-15% of prospecting budget to email/SMS retention campaigns. ` +
                    `Existing customers have higher conversion rates and lower acquisition costs.`,
                dataPoints: [
                    `Current repeat rate: ${revenueData.repeatRate.toFixed(0)}%`,
                    `Industry benchmark: 20-30%`,
                    `Avg order value: $${revenueData.avgOrderValue.toFixed(0)}`,
                    `Strategy: Email flows, loyalty programs, post-purchase sequences`
                ],
                action: {
                    actionType: 'budget_decrease',
                    campaignId: 'portfolio',
                    campaignName: 'Cold Prospecting',
                    platform: 'both',
                    currentBudget: 0,
                    suggestedBudget: 0,
                    changeAmount: 0,
                    changePercent: -15,
                    reason: 'Rebalance to retention-focused marketing'
                } as BudgetAction,
                confidence: 60,
                platform: 'both',
                source: 'MarketingStrategyAdvisor',
                tags: ['retention', 'ltv', 'efficiency']
            });
        }

        // If AOV is high, can afford higher CPA
        if (revenueData.avgOrderValue > 100) {
            const affordableCpa = revenueData.avgOrderValue * 0.25; // 25% of AOV
            recs.push({
                id: `strategy_aov_${Date.now()}`,
                priority: 3,
                category: 'optimization',
                headline: `📦 High AOV ($${revenueData.avgOrderValue.toFixed(0)}): You can afford $${affordableCpa.toFixed(0)} CPA`,
                explanation: `With an average order value of $${revenueData.avgOrderValue.toFixed(0)}, ` +
                    `you can profitably acquire customers at up to $${affordableCpa.toFixed(0)} CPA (25% of AOV). ` +
                    `Use this as your target CPA bidding cap.`,
                dataPoints: [
                    `AOV: $${revenueData.avgOrderValue.toFixed(0)}`,
                    `Max profitable CPA: $${affordableCpa.toFixed(0)}`,
                    `Assumption: 25% of AOV to acquisition`
                ],
                action: {
                    actionType: 'budget_increase',
                    campaignId: 'portfolio',
                    campaignName: 'Prospecting Campaigns',
                    platform: 'both',
                    currentBudget: 0,
                    suggestedBudget: 0,
                    changeAmount: 0,
                    changePercent: 0,
                    reason: 'AOV enables aggressive CPA bidding'
                } as BudgetAction,
                confidence: 55,
                platform: 'both',
                source: 'MarketingStrategyAdvisor',
                tags: ['aov', 'cpa', 'bidding']
            });
        }

        return recs;
    }
}
