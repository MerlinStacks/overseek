/**
 * Roadblock Analytics Service
 * Identifies friction points where visitors drop off with potential revenue loss
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

interface RoadblockPage {
    url: string;
    pageTitle: string;
    totalVisits: number;
    exits: number;
    exitRate: number;
    avgCartValue: number;
    potentialRevenueLost: number;
}

export class RoadblockAnalytics {

    /**
     * Get pages with high exit rates where visitors had items in cart
     * These represent friction points causing potential revenue loss
     */
    static async getRoadblockPages(
        accountId: string,
        startDate?: string,
        endDate?: string,
        minExitRate: number = 30
    ): Promise<RoadblockPage[]> {
        try {
            const dateFilter: any = {};
            if (startDate) {
                dateFilter.gte = new Date(startDate);
            }
            if (endDate) {
                dateFilter.lte = new Date(endDate);
            }

            // Get all exit events (last pageview before session goes inactive)
            // We identify exits by finding the last page view event per session
            const sessions = await prisma.analyticsSession.findMany({
                where: {
                    accountId,
                    ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter })
                },
                include: {
                    events: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        where: { type: 'pageview' }
                    }
                }
            });

            // Group by exit page URL
            const pageStats = new Map<string, {
                url: string;
                pageTitle: string;
                totalVisits: number;
                exits: number;
                cartValues: number[];
            }>();

            for (const session of sessions) {
                if (session.events.length === 0) continue;

                const lastEvent = session.events[0];
                const url = normalizeUrl(lastEvent.url);
                const cartValue = Number(session.cartValue) || 0;

                if (!pageStats.has(url)) {
                    pageStats.set(url, {
                        url,
                        pageTitle: lastEvent.pageTitle || url,
                        totalVisits: 0,
                        exits: 0,
                        cartValues: []
                    });
                }

                const stats = pageStats.get(url)!;
                stats.totalVisits++;
                stats.exits++;

                if (cartValue > 0) {
                    stats.cartValues.push(cartValue);
                }
            }

            // Calculate exit rates and filter
            const roadblocks: RoadblockPage[] = [];

            for (const [url, stats] of pageStats) {
                const exitRate = stats.totalVisits > 0
                    ? (stats.exits / stats.totalVisits) * 100
                    : 0;

                const avgCartValue = stats.cartValues.length > 0
                    ? stats.cartValues.reduce((a, b) => a + b, 0) / stats.cartValues.length
                    : 0;

                const potentialRevenueLost = stats.cartValues.reduce((a, b) => a + b, 0);

                // Only include pages with meaningful exit rates and potential revenue loss
                if (exitRate >= minExitRate && potentialRevenueLost > 0) {
                    roadblocks.push({
                        url,
                        pageTitle: stats.pageTitle,
                        totalVisits: stats.totalVisits,
                        exits: stats.exits,
                        exitRate: Math.round(exitRate * 10) / 10,
                        avgCartValue: Math.round(avgCartValue * 100) / 100,
                        potentialRevenueLost: Math.round(potentialRevenueLost * 100) / 100
                    });
                }
            }

            // Sort by potential revenue lost (descending)
            roadblocks.sort((a, b) => b.potentialRevenueLost - a.potentialRevenueLost);

            return roadblocks.slice(0, 50);
        } catch (error) {
            Logger.error('Roadblock Analytics Error', { error });
            return [];
        }
    }

    /**
     * Get checkout funnel drop-off analysis
     * Tracks progression: product view → add to cart → checkout → purchase
     */
    static async getDropOffFunnel(
        accountId: string,
        startDate?: string,
        endDate?: string
    ) {
        try {
            const dateFilter: any = {};
            if (startDate) {
                dateFilter.gte = new Date(startDate);
            }
            if (endDate) {
                dateFilter.lte = new Date(endDate);
            }

            // Count events by type
            const eventCounts = await prisma.analyticsEvent.groupBy({
                by: ['type'],
                where: {
                    session: {
                        accountId,
                        ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter })
                    },
                    type: {
                        in: ['pageview', 'add_to_cart', 'checkout_start', 'purchase']
                    }
                },
                _count: {
                    id: true
                }
            });

            const countMap = new Map<string, number>();
            for (const ec of eventCounts) {
                countMap.set(ec.type, ec._count.id);
            }

            const productViews = countMap.get('pageview') || 0;
            const addToCarts = countMap.get('add_to_cart') || 0;
            const checkoutStarts = countMap.get('checkout_start') || 0;
            const purchases = countMap.get('purchase') || 0;

            return {
                funnel: [
                    { stage: 'Product Views', count: productViews, dropOff: null },
                    {
                        stage: 'Add to Cart',
                        count: addToCarts,
                        dropOff: productViews > 0 ? Math.round((1 - addToCarts / productViews) * 100) : 0
                    },
                    {
                        stage: 'Checkout Started',
                        count: checkoutStarts,
                        dropOff: addToCarts > 0 ? Math.round((1 - checkoutStarts / addToCarts) * 100) : 0
                    },
                    {
                        stage: 'Purchase',
                        count: purchases,
                        dropOff: checkoutStarts > 0 ? Math.round((1 - purchases / checkoutStarts) * 100) : 0
                    }
                ],
                overallConversionRate: productViews > 0
                    ? Math.round((purchases / productViews) * 10000) / 100
                    : 0
            };
        } catch (error) {
            Logger.error('Drop-off Funnel Error', { error });
            return { funnel: [], overallConversionRate: 0 };
        }
    }
}

/**
 * Normalize URL by removing query params and trailing slashes for grouping
 */
function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        // Keep path only, remove query string
        let path = parsed.pathname;
        // Remove trailing slash unless it's the root
        if (path.length > 1 && path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        return path;
    } catch {
        return url;
    }
}
