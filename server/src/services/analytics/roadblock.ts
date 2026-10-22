/**
 * Roadblock Analytics Service
 * Identifies friction points where visitors drop off with potential revenue loss
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { pageVisitCtes } from './pageVisits';

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
    private static validateWindow(accountId: string, startDate?: string, endDate?: string) {
        const start = startDate ? new Date(startDate) : new Date(0), end = endDate ? new Date(endDate) : new Date();
        if (!accountId || accountId.length > 200 || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error('Valid account and chronological observation window required');
    }

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
        this.validateWindow(accountId, startDate, endDate);
        if (!Number.isFinite(minExitRate) || minExitRate < 0 || minExitRate > 100) throw new Error('Invalid exit threshold');
        try {
            const start = startDate ? new Date(startDate) : new Date(0);
            const end = endDate ? new Date(endDate) : new Date();
            const rows = await prisma.$queryRaw<Array<{
                url: string; pageTitle: string | null; totalVisits: bigint; exits: bigint;
                avgCartValue: unknown; potentialRevenueLost: unknown;
            }>>`
                ${pageVisitCtes(accountId, start, end)}, CartAmounts AS (
                    SELECT visit_key, id, "createdAt",
                        CASE WHEN type IN ('purchase', 'checkout_success') THEN '0'
                        ELSE COALESCE(payload->>'cartTotal', payload->>'total',
                            payload->>'value', payload->>'price', payload->>'amount') END AS amount
                    FROM VisitActivity
                    WHERE type IN ('add_to_cart', 'remove_from_cart', 'update_cart',
                        'cart_view', 'checkout_view', 'checkout_start', 'purchase', 'checkout_success')
                ), ExitCarts AS (
                    -- Snapshot within this visit, never the visitor's present-day cart.
                    SELECT DISTINCT ON (visit_key) visit_key, amount::numeric AS value
                    FROM CartAmounts
                    WHERE amount ~ '^[0-9]+([.][0-9]+)?$'
                    ORDER BY visit_key, "createdAt" DESC, id DESC
                ), InactiveVisits AS (
                    SELECT visit_key FROM VisitActivity
                    GROUP BY visit_key
                    HAVING MAX("createdAt") <= NOW() - INTERVAL '30 minutes'
                )
                SELECT v.url, t."pageTitle", COUNT(DISTINCT v.visit_key) AS "totalVisits",
                    COUNT(*) FILTER (WHERE v.exit_rank = 1 AND i.visit_key IS NOT NULL) AS exits,
                    COALESCE(AVG(c.value) FILTER (WHERE v.exit_rank = 1
                        AND i.visit_key IS NOT NULL AND c.value > 0), 0) AS "avgCartValue",
                    COALESCE(SUM(c.value) FILTER (WHERE v.exit_rank = 1
                        AND i.visit_key IS NOT NULL AND c.value > 0), 0) AS "potentialRevenueLost"
                FROM RankedVisits v
                LEFT JOIN PageTitles t ON t.url = v.url
                LEFT JOIN ExitCarts c ON c.visit_key = v.visit_key
                LEFT JOIN InactiveVisits i ON i.visit_key = v.visit_key
                GROUP BY v.url, t."pageTitle"
            `;

            return rows.map(row => ({
                url: row.url,
                pageTitle: row.pageTitle || row.url,
                totalVisits: Number(row.totalVisits),
                exits: Number(row.exits),
                exitRate: row.totalVisits ? Number(row.exits) / Number(row.totalVisits) * 100 : 0,
                avgCartValue: Math.round(Number(row.avgCartValue) * 100) / 100,
                potentialRevenueLost: Math.round(Number(row.potentialRevenueLost) * 100) / 100,
            })).filter(row => row.exitRate >= minExitRate && row.potentialRevenueLost > 0)
                .map(row => ({ ...row, exitRate: Math.round(row.exitRate * 10) / 10 }))
                .sort((a, b) => b.potentialRevenueLost - a.potentialRevenueLost)
                .slice(0, 50);
        } catch (error) {
            Logger.error('Roadblock Analytics Error', { error });
            throw error;
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
        this.validateWindow(accountId, startDate, endDate);
        try {
            const dateFilter: any = {};
            if (startDate) {
                dateFilter.gte = new Date(startDate);
            }
            if (endDate) {
                dateFilter.lt = new Date(endDate);
            }

            // Count events by type
            const eventCounts = await prisma.analyticsEvent.groupBy({
                by: ['type'],
                where: {
                    session: { accountId },
                    ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
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
                    { stage: 'Pageview events', count: productViews, dropOff: null },
                    {
                        stage: 'Add to Cart',
                        count: addToCarts,
                        dropOff: null
                    },
                    {
                        stage: 'Checkout Started',
                        count: checkoutStarts,
                        dropOff: null
                    },
                    {
                        stage: 'Purchase',
                        count: purchases,
                        dropOff: null
                    }
                ],
                overallConversionRate: null,
                basis: 'independent event counts in the requested event-time window; not an ordered unique-person funnel'
            };
        } catch (error) {
            Logger.error('Drop-off Funnel Error', { error });
            throw error;
        }
    }
}
