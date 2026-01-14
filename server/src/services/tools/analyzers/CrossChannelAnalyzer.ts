/**
 * Cross-Channel Analyzer
 * 
 * Correlates Google and Meta ad performance using attribution data.
 * Identifies assisted conversions and provides cross-platform budget recommendations.
 * 
 * Part of AI Marketing Co-Pilot Phase 2.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface CrossChannelInsight {
    hasData: boolean;

    // Revenue attribution by channel
    channelPerformance: {
        channel: string;
        revenue: number;
        orders: number;
        aov: number;
        revenueShare: number;  // Percentage
    }[];

    // Channel interaction patterns
    assistedConversions: {
        googleAssistedMeta: number;   // First touch Google, converted on Meta
        metaAssistedGoogle: number;   // First touch Meta, converted on Google
        organicAssisted: number;      // First touch organic, paid conversion
    };

    // Customer journey insights
    channelOverlap: {
        multiChannel: number;         // Customers who interacted with multiple channels
        singleChannel: number;
        multiChannelRevenue: number;
        avgTouchpointsBeforePurchase: number;
    };

    // Budget recommendations
    budgetRecommendation: {
        currentSplit: { google: number; meta: number; organic: number };
        recommendedSplit: { google: number; meta: number };
        rationale: string;
        confidence: 'low' | 'medium' | 'high';
    } | null;

    suggestions: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

import { normalizeChannel } from '../utils/ChannelUtils';

// Alias for backwards compatibility
const normalizeSource = normalizeChannel;

// =============================================================================
// MAIN ANALYZER
// =============================================================================

export class CrossChannelAnalyzer {

    /**
     * Analyze cross-channel attribution and performance.
     */
    static async analyze(accountId: string, days: number = 90): Promise<CrossChannelInsight> {
        const result: CrossChannelInsight = {
            hasData: false,
            channelPerformance: [],
            assistedConversions: {
                googleAssistedMeta: 0,
                metaAssistedGoogle: 0,
                organicAssisted: 0
            },
            channelOverlap: {
                multiChannel: 0,
                singleChannel: 0,
                multiChannelRevenue: 0,
                avgTouchpointsBeforePurchase: 1
            },
            budgetRecommendation: null,
            suggestions: []
        };

        try {
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            // Get all orders with their attribution
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    dateCreated: { gte: startDate },
                    status: { in: ['completed', 'processing'] }
                },
                select: {
                    wooId: true,
                    total: true,
                    dateCreated: true,
                    rawData: true
                }
            });

            if (orders.length === 0) {
                return result;
            }

            // Get purchase events with attribution
            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'purchase',
                    createdAt: { gte: startDate }
                },
                include: {
                    session: {
                        select: {
                            firstTouchSource: true,
                            lastTouchSource: true,
                            utmSource: true,
                            utmMedium: true,
                            utmCampaign: true
                        }
                    }
                }
            });

            // Build order -> attribution map
            const orderAttributionMap = new Map<number, {
                firstTouch: string;
                lastTouch: string;
                utmSource: string | null;
                utmCampaign: string | null;
            }>();

            for (const event of purchaseEvents) {
                const orderId = (event.payload as any)?.orderId || (event.payload as any)?.order_id;
                if (orderId && event.session) {
                    orderAttributionMap.set(Number(orderId), {
                        firstTouch: normalizeSource(event.session.firstTouchSource),
                        lastTouch: normalizeSource(event.session.lastTouchSource),
                        utmSource: event.session.utmSource,
                        utmCampaign: event.session.utmCampaign
                    });
                }
            }

            // Calculate channel performance
            const channelRevenue = new Map<string, { revenue: number; orders: number }>();
            let totalRevenue = 0;
            let attributedOrders = 0;

            for (const order of orders) {
                const total = parseFloat(String(order.total)) || 0;
                totalRevenue += total;

                const attribution = orderAttributionMap.get(order.wooId);
                const channel = attribution?.lastTouch || 'direct';

                const current = channelRevenue.get(channel) || { revenue: 0, orders: 0 };
                current.revenue += total;
                current.orders += 1;
                channelRevenue.set(channel, current);

                if (attribution) {
                    attributedOrders++;

                    // Count assisted conversions
                    if (attribution.firstTouch !== attribution.lastTouch) {
                        result.channelOverlap.multiChannel++;
                        result.channelOverlap.multiChannelRevenue += total;

                        // Track cross-platform assists
                        if (attribution.firstTouch === 'google' && attribution.lastTouch === 'meta') {
                            result.assistedConversions.googleAssistedMeta++;
                        } else if (attribution.firstTouch === 'meta' && attribution.lastTouch === 'google') {
                            result.assistedConversions.metaAssistedGoogle++;
                        } else if (
                            (attribution.firstTouch === 'organic_search' || attribution.firstTouch === 'direct') &&
                            (attribution.lastTouch === 'google' || attribution.lastTouch === 'meta')
                        ) {
                            result.assistedConversions.organicAssisted++;
                        }
                    } else {
                        result.channelOverlap.singleChannel++;
                    }
                }
            }

            // Convert to performance array
            result.channelPerformance = Array.from(channelRevenue.entries())
                .map(([channel, data]) => ({
                    channel,
                    revenue: Math.round(data.revenue * 100) / 100,
                    orders: data.orders,
                    aov: data.orders > 0 ? Math.round((data.revenue / data.orders) * 100) / 100 : 0,
                    revenueShare: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 1000) / 10 : 0
                }))
                .sort((a, b) => b.revenue - a.revenue);

            result.hasData = true;

            // Calculate average touchpoints (simplified - assume multi-channel = 2, single = 1)
            const totalCustomers = result.channelOverlap.multiChannel + result.channelOverlap.singleChannel;
            if (totalCustomers > 0) {
                result.channelOverlap.avgTouchpointsBeforePurchase =
                    Math.round(((result.channelOverlap.multiChannel * 2) + result.channelOverlap.singleChannel) / totalCustomers * 10) / 10;
            }

            // Generate budget recommendation
            result.budgetRecommendation = this.generateBudgetRecommendation(result.channelPerformance, totalRevenue);

            // Generate suggestions
            this.generateSuggestions(result);

        } catch (error) {
            Logger.error('CrossChannelAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /**
     * Generate budget allocation recommendation based on channel performance.
     */
    private static generateBudgetRecommendation(
        channelPerformance: CrossChannelInsight['channelPerformance'],
        totalRevenue: number
    ): CrossChannelInsight['budgetRecommendation'] {
        const googleData = channelPerformance.find(c => c.channel === 'google');
        const metaData = channelPerformance.find(c => c.channel === 'meta');

        if (!googleData && !metaData) return null;

        const googleRevenue = googleData?.revenue || 0;
        const metaRevenue = metaData?.revenue || 0;
        const organicRevenue = channelPerformance
            .filter(c => !['google', 'meta'].includes(c.channel))
            .reduce((sum, c) => sum + c.revenue, 0);

        const paidTotal = googleRevenue + metaRevenue;
        if (paidTotal === 0) return null;

        const currentSplit = {
            google: Math.round((googleRevenue / totalRevenue) * 100),
            meta: Math.round((metaRevenue / totalRevenue) * 100),
            organic: Math.round((organicRevenue / totalRevenue) * 100)
        };

        // Simple heuristic: allocate more to higher-performing channel
        const googleAov = googleData?.aov || 0;
        const metaAov = metaData?.aov || 0;

        let recommendedSplit: { google: number; meta: number };
        let rationale: string;

        // If one channel significantly outperforms (30%+ higher AOV)
        if (googleAov > metaAov * 1.3 && googleRevenue > 0) {
            recommendedSplit = {
                google: Math.min(70, currentSplit.google + 10),
                meta: Math.max(30, currentSplit.meta - 10)
            };
            rationale = `Google has ${Math.round((googleAov / metaAov - 1) * 100)}% higher AOV ($${googleAov} vs $${metaAov}). Consider shifting budget toward Google.`;
        } else if (metaAov > googleAov * 1.3 && metaRevenue > 0) {
            recommendedSplit = {
                google: Math.max(30, currentSplit.google - 10),
                meta: Math.min(70, currentSplit.meta + 10)
            };
            rationale = `Meta has ${Math.round((metaAov / googleAov - 1) * 100)}% higher AOV ($${metaAov} vs $${googleAov}). Consider shifting budget toward Meta.`;
        } else {
            recommendedSplit = {
                google: 50,
                meta: 50
            };
            rationale = `Both channels perform similarly (Google AOV: $${googleAov}, Meta AOV: $${metaAov}). Maintain balanced allocation.`;
        }

        // Normalize to 100%
        const total = recommendedSplit.google + recommendedSplit.meta;
        recommendedSplit.google = Math.round((recommendedSplit.google / total) * 100);
        recommendedSplit.meta = 100 - recommendedSplit.google;

        return {
            currentSplit,
            recommendedSplit,
            rationale,
            confidence: paidTotal > 5000 ? 'high' : paidTotal > 1000 ? 'medium' : 'low'
        };
    }

    /**
     * Generate actionable suggestions from cross-channel analysis.
     */
    private static generateSuggestions(result: CrossChannelInsight): void {
        const { assistedConversions, channelOverlap, budgetRecommendation, channelPerformance } = result;

        // Multi-channel journey insight
        const multiChannelPct = channelOverlap.multiChannel + channelOverlap.singleChannel > 0
            ? Math.round((channelOverlap.multiChannel / (channelOverlap.multiChannel + channelOverlap.singleChannel)) * 100)
            : 0;

        if (multiChannelPct > 20) {
            result.suggestions.push(
                `🔀 **Multi-Channel Journeys**: ${multiChannelPct}% of customers interact with multiple channels before purchase. ` +
                `Don't evaluate channels in isolation - they work together.`
            );
        }

        // Cross-platform assists
        const totalAssists = assistedConversions.googleAssistedMeta + assistedConversions.metaAssistedGoogle;
        if (totalAssists > 5) {
            if (assistedConversions.googleAssistedMeta > assistedConversions.metaAssistedGoogle * 2) {
                result.suggestions.push(
                    `🔄 **Google Assists Meta**: ${assistedConversions.googleAssistedMeta} customers discovered you via Google but converted through Meta. ` +
                    `Google may be undervalued in last-click attribution.`
                );
            } else if (assistedConversions.metaAssistedGoogle > assistedConversions.googleAssistedMeta * 2) {
                result.suggestions.push(
                    `🔄 **Meta Assists Google**: ${assistedConversions.metaAssistedGoogle} customers discovered you via Meta but converted through Google. ` +
                    `Meta may be undervalued in last-click attribution.`
                );
            }
        }

        // Budget recommendation
        if (budgetRecommendation && budgetRecommendation.confidence !== 'low') {
            result.suggestions.push(
                `💰 **Budget Allocation**: ${budgetRecommendation.rationale} ` +
                `(Confidence: ${budgetRecommendation.confidence})`
            );
        }

        // Channel concentration warning
        const topChannel = channelPerformance[0];
        if (topChannel && topChannel.revenueShare > 70) {
            result.suggestions.push(
                `⚠️ **Channel Concentration**: ${topChannel.revenueShare}% of revenue comes from ${topChannel.channel}. ` +
                `Consider diversifying to reduce platform dependency risk.`
            );
        }
    }
}
