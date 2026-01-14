/**
 * LTV Analyzer
 * 
 * Calculates Customer Lifetime Value by acquisition channel
 * and provides LTV-adjusted optimization recommendations.
 * 
 * Part of AI Marketing Co-Pilot Phase 2.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface ChannelLTV {
    channel: string;
    customers: number;
    totalRevenue: number;
    avgLtv: number;
    avgOrders: number;
    avgDaysBetweenOrders: number;
    repeatRate: number;        // % of customers who ordered more than once
    projectedLtv12m: number;   // Projected 12-month LTV
}

export interface LTVInsight {
    hasData: boolean;

    // LTV by acquisition channel
    channelLtv: ChannelLTV[];

    // Overall metrics
    overall: {
        avgLtv: number;
        avgOrders: number;
        repeatRate: number;
        avgDaysBetweenOrders: number;
    };

    // High-value segments
    highValueSegments: {
        channel: string;
        segment: string;
        avgLtv: number;
        customers: number;
        insight: string;
    }[];

    // LTV-adjusted ROAS (if we have spend data)
    ltvAdjustedMetrics: {
        channel: string;
        immediateRoas: number;     // Standard last-click ROAS
        ltvAdjustedRoas: number;   // ROAS using projected LTV
        multiplier: number;        // How much higher LTV-adjusted is
    }[];

    suggestions: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

import { normalizeChannel } from '../utils/ChannelUtils';

// =============================================================================
// MAIN ANALYZER
// =============================================================================

export class LTVAnalyzer {

    /**
     * Analyze customer lifetime value by acquisition channel.
     */
    static async analyze(accountId: string): Promise<LTVInsight> {
        const result: LTVInsight = {
            hasData: false,
            channelLtv: [],
            overall: {
                avgLtv: 0,
                avgOrders: 0,
                repeatRate: 0,
                avgDaysBetweenOrders: 0
            },
            highValueSegments: [],
            ltvAdjustedMetrics: [],
            suggestions: []
        };

        try {
            // Get all customers with their order history
            const customers = await prisma.wooCustomer.findMany({
                where: { accountId },
                select: {
                    id: true,
                    wooId: true,
                    email: true,
                    totalSpent: true,
                    ordersCount: true,
                    createdAt: true
                }
            });

            if (customers.length === 0) {
                return result;
            }

            // Get all orders for order date analysis
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: ['completed', 'processing'] }
                },
                select: {
                    wooId: true,
                    total: true,
                    dateCreated: true,
                    rawData: true
                },
                orderBy: { dateCreated: 'asc' }
            });

            // Get first-touch attribution for customers
            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'purchase'
                },
                include: {
                    session: {
                        select: {
                            firstTouchSource: true,
                            visitorId: true
                        }
                    }
                },
                orderBy: { createdAt: 'asc' }
            });

            // Build customer -> first acquisition channel map
            // Use the FIRST purchase event's first touch as acquisition channel
            const customerAcquisitionChannel = new Map<string, string>();

            for (const event of purchaseEvents) {
                const orderId = (event.payload as any)?.orderId;
                if (orderId && event.session?.visitorId) {
                    // Find which customer this order belongs to
                    const order = orders.find(o => o.wooId === Number(orderId));
                    if (order) {
                        const customerEmail = (order.rawData as any)?.billing?.email;
                        if (customerEmail && !customerAcquisitionChannel.has(customerEmail)) {
                            customerAcquisitionChannel.set(
                                customerEmail.toLowerCase(),
                                normalizeChannel(event.session.firstTouchSource)
                            );
                        }
                    }
                }
            }

            // Build customer order history
            const customerOrders = new Map<string, { dates: Date[]; totals: number[] }>();

            for (const order of orders) {
                const email = (order.rawData as any)?.billing?.email?.toLowerCase();
                if (!email) continue;

                const existing = customerOrders.get(email) || { dates: [], totals: [] };
                existing.dates.push(new Date(order.dateCreated));
                existing.totals.push(parseFloat(String(order.total)) || 0);
                customerOrders.set(email, existing);
            }

            // Calculate LTV by channel
            const channelData = new Map<string, {
                customers: number;
                totalRevenue: number;
                totalOrders: number;
                repeatCustomers: number;
                daysBetweenOrders: number[];
            }>();

            let overallTotalRevenue = 0;
            let overallTotalOrders = 0;
            let overallRepeatCustomers = 0;
            let allDaysBetween: number[] = [];

            for (const customer of customers) {
                const email = customer.email.toLowerCase();
                const channel = customerAcquisitionChannel.get(email) || 'direct';
                const ltv = parseFloat(String(customer.totalSpent)) || 0;
                const orderCount = customer.ordersCount || 1;

                overallTotalRevenue += ltv;
                overallTotalOrders += orderCount;
                if (orderCount > 1) overallRepeatCustomers++;

                const data = channelData.get(channel) || {
                    customers: 0,
                    totalRevenue: 0,
                    totalOrders: 0,
                    repeatCustomers: 0,
                    daysBetweenOrders: []
                };

                data.customers++;
                data.totalRevenue += ltv;
                data.totalOrders += orderCount;
                if (orderCount > 1) data.repeatCustomers++;

                // Calculate days between orders for this customer
                const orderHistory = customerOrders.get(email);
                if (orderHistory && orderHistory.dates.length > 1) {
                    for (let i = 1; i < orderHistory.dates.length; i++) {
                        const daysDiff = Math.round(
                            (orderHistory.dates[i].getTime() - orderHistory.dates[i - 1].getTime())
                            / (1000 * 60 * 60 * 24)
                        );
                        if (daysDiff > 0 && daysDiff < 365) {
                            data.daysBetweenOrders.push(daysDiff);
                            allDaysBetween.push(daysDiff);
                        }
                    }
                }

                channelData.set(channel, data);
            }

            // Convert to LTV array
            result.channelLtv = Array.from(channelData.entries())
                .map(([channel, data]) => {
                    const avgLtv = data.customers > 0 ? data.totalRevenue / data.customers : 0;
                    const avgOrders = data.customers > 0 ? data.totalOrders / data.customers : 0;
                    const avgDaysBetween = data.daysBetweenOrders.length > 0
                        ? data.daysBetweenOrders.reduce((a, b) => a + b, 0) / data.daysBetweenOrders.length
                        : 0;
                    const repeatRate = data.customers > 0 ? (data.repeatCustomers / data.customers) * 100 : 0;

                    // Project 12-month LTV based on repeat rate and avg order value
                    const avgOrderValue = avgOrders > 0 ? avgLtv / avgOrders : 0;
                    const ordersPerYear = avgDaysBetween > 0 ? 365 / avgDaysBetween : avgOrders;
                    const projectedLtv12m = avgOrderValue * Math.min(ordersPerYear, 12); // Cap at 12 orders/year

                    return {
                        channel,
                        customers: data.customers,
                        totalRevenue: Math.round(data.totalRevenue * 100) / 100,
                        avgLtv: Math.round(avgLtv * 100) / 100,
                        avgOrders: Math.round(avgOrders * 100) / 100,
                        avgDaysBetweenOrders: Math.round(avgDaysBetween),
                        repeatRate: Math.round(repeatRate * 10) / 10,
                        projectedLtv12m: Math.round(projectedLtv12m * 100) / 100
                    };
                })
                .sort((a, b) => b.avgLtv - a.avgLtv);

            // Overall metrics
            result.overall = {
                avgLtv: customers.length > 0 ? Math.round((overallTotalRevenue / customers.length) * 100) / 100 : 0,
                avgOrders: customers.length > 0 ? Math.round((overallTotalOrders / customers.length) * 100) / 100 : 0,
                repeatRate: customers.length > 0 ? Math.round((overallRepeatCustomers / customers.length) * 1000) / 10 : 0,
                avgDaysBetweenOrders: allDaysBetween.length > 0
                    ? Math.round(allDaysBetween.reduce((a, b) => a + b, 0) / allDaysBetween.length)
                    : 0
            };

            result.hasData = true;

            // Identify high-value segments
            this.identifyHighValueSegments(result);

            // Generate suggestions
            this.generateSuggestions(result);

        } catch (error) {
            Logger.error('LTVAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /**
     * Identify high-value customer segments.
     */
    private static identifyHighValueSegments(result: LTVInsight): void {
        const avgLtv = result.overall.avgLtv;

        for (const channel of result.channelLtv) {
            if (channel.customers < 5) continue; // Skip small samples

            // High LTV channel
            if (channel.avgLtv > avgLtv * 1.3) {
                result.highValueSegments.push({
                    channel: channel.channel,
                    segment: 'High LTV',
                    avgLtv: channel.avgLtv,
                    customers: channel.customers,
                    insight: `${channel.channel} customers have ${Math.round((channel.avgLtv / avgLtv - 1) * 100)}% higher LTV than average`
                });
            }

            // High repeat rate channel
            if (channel.repeatRate > result.overall.repeatRate * 1.5) {
                result.highValueSegments.push({
                    channel: channel.channel,
                    segment: 'High Repeat',
                    avgLtv: channel.avgLtv,
                    customers: channel.customers,
                    insight: `${channel.channel} customers have ${channel.repeatRate.toFixed(1)}% repeat rate vs ${result.overall.repeatRate.toFixed(1)}% average`
                });
            }
        }
    }

    /**
     * Generate LTV-based recommendations.
     */
    private static generateSuggestions(result: LTVInsight): void {
        const { channelLtv, overall, highValueSegments } = result;

        if (channelLtv.length === 0) return;

        // Find best LTV channel
        const bestLtvChannel = channelLtv[0];
        const worstLtvChannel = channelLtv[channelLtv.length - 1];

        if (bestLtvChannel && worstLtvChannel && bestLtvChannel.avgLtv > worstLtvChannel.avgLtv * 1.5) {
            result.suggestions.push(
                `💎 **LTV Leader**: ${bestLtvChannel.channel} customers have $${bestLtvChannel.avgLtv} average LTV ` +
                `(${Math.round((bestLtvChannel.avgLtv / worstLtvChannel.avgLtv - 1) * 100)}% higher than ${worstLtvChannel.channel}). ` +
                `Consider increasing acquisition spend on ${bestLtvChannel.channel}.`
            );
        }

        // Repeat rate insights
        const highRepeatChannel = channelLtv.find(c => c.repeatRate > 30 && c.customers >= 10);
        if (highRepeatChannel) {
            result.suggestions.push(
                `🔄 **High Repeat Channel**: ${highRepeatChannel.repeatRate.toFixed(1)}% of ${highRepeatChannel.channel} customers ` +
                `make repeat purchases. These customers are worth investing more to acquire.`
            );
        }

        // Low repeat rate warning
        if (overall.repeatRate < 15 && overall.avgOrders < 1.3) {
            result.suggestions.push(
                `⚠️ **Retention Opportunity**: Only ${overall.repeatRate.toFixed(1)}% repeat purchase rate. ` +
                `Consider email remarketing, loyalty programs, or post-purchase engagement to increase LTV.`
            );
        }

        // LTV vs immediate ROAS insight
        const paidChannels = channelLtv.filter(c => ['google', 'meta'].includes(c.channel));
        if (paidChannels.length > 0) {
            const avgPaidLtv = paidChannels.reduce((sum, c) => sum + c.avgLtv * c.customers, 0) /
                paidChannels.reduce((sum, c) => sum + c.customers, 0);

            if (avgPaidLtv > overall.avgLtv * 0.8) {
                result.suggestions.push(
                    `📊 **LTV Justifies CAC**: Paid channel customers have $${avgPaidLtv.toFixed(0)} LTV. ` +
                    `Even if immediate ROAS looks marginal, LTV value justifies acquisition cost.`
                );
            }
        }

        // Projected LTV insight
        const projectedChannel = channelLtv.find(c => c.projectedLtv12m > c.avgLtv * 1.5 && c.repeatRate > 20);
        if (projectedChannel) {
            result.suggestions.push(
                `📈 **Growth Potential**: ${projectedChannel.channel} customers are projected to reach ` +
                `$${projectedChannel.projectedLtv12m} LTV over 12 months (current: $${projectedChannel.avgLtv}). ` +
                `Factor this into CAC decisions.`
            );
        }
    }

    /**
     * Get a formatted summary string.
     */
    static formatSummary(insight: LTVInsight): string {
        if (!insight.hasData) {
            return 'No customer LTV data available.';
        }

        const lines = [
            `**Overall LTV**: $${insight.overall.avgLtv} (${insight.overall.avgOrders.toFixed(1)} orders avg)`,
            `**Repeat Rate**: ${insight.overall.repeatRate}%`
        ];

        if (insight.channelLtv.length > 0) {
            const top = insight.channelLtv[0];
            lines.push(`**Best Channel**: ${top.channel} ($${top.avgLtv} LTV)`);
        }

        return lines.join('\n');
    }
}
