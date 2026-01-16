/**
 * Revenue Metrics
 * 
 * Revenue analytics with attribution tracking.
 * Extracted from MetricsService for modularity.
 */

import { prisma } from '../../utils/prisma';

/**
 * Get revenue analytics: AOV, total, by source.
 * Uses WooCommerce orders as the primary source of truth for revenue totals,
 * enriched with analytics session data for attribution when available.
 */
export async function getRevenue(accountId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Primary source: WooCommerce orders
    const orders = await prisma.wooOrder.findMany({
        where: {
            accountId,
            dateCreated: { gte: startDate },
            status: { in: ['completed', 'processing'] }
        },
        select: { wooId: true, total: true, rawData: true }
    });

    // Secondary source: Analytics sessions for attribution
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
                    country: true,
                    deviceType: true
                }
            }
        }
    });

    // Map orderId to session attribution data
    const orderAttributionMap = new Map<number, {
        firstTouchSource: string | null;
        lastTouchSource: string | null;
        country: string | null;
        deviceType: string | null;
    }>();

    for (const event of purchaseEvents) {
        const orderId = (event.payload as any)?.orderId;
        if (orderId && event.session) {
            // Session data is correctly typed via the select above
            orderAttributionMap.set(orderId, event.session);
        }
    }

    let totalRevenue = 0;
    const revenueByFirstTouch = new Map<string, number>();
    const revenueByLastTouch = new Map<string, number>();
    const revenueByCountry = new Map<string, number>();
    const revenueByDevice = new Map<string, number>();

    for (const order of orders) {
        const total = parseFloat(String(order.total)) || 0;
        totalRevenue += total;

        const attribution = orderAttributionMap.get(order.wooId);

        if (attribution) {
            const firstTouch = attribution.firstTouchSource || 'direct';
            const lastTouch = attribution.lastTouchSource || 'direct';
            const country = attribution.country || 'Unknown';
            const device = attribution.deviceType || 'unknown';

            revenueByFirstTouch.set(firstTouch, (revenueByFirstTouch.get(firstTouch) || 0) + total);
            revenueByLastTouch.set(lastTouch, (revenueByLastTouch.get(lastTouch) || 0) + total);
            revenueByCountry.set(country, (revenueByCountry.get(country) || 0) + total);
            revenueByDevice.set(device, (revenueByDevice.get(device) || 0) + total);
        } else {
            const rawDataObj = order.rawData as any;
            const country = rawDataObj?.billing?.country || 'Unknown';

            revenueByFirstTouch.set('direct', (revenueByFirstTouch.get('direct') || 0) + total);
            revenueByLastTouch.set('direct', (revenueByLastTouch.get('direct') || 0) + total);
            revenueByCountry.set(country, (revenueByCountry.get(country) || 0) + total);
            revenueByDevice.set('unknown', (revenueByDevice.get('unknown') || 0) + total);
        }
    }

    const orderCount = orders.length;
    const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

    return {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        orderCount,
        aov: Math.round(aov * 100) / 100,
        byFirstTouch: mapToSortedArray(revenueByFirstTouch, 'source', 'revenue'),
        byLastTouch: mapToSortedArray(revenueByLastTouch, 'source', 'revenue'),
        byCountry: mapToSortedArray(revenueByCountry, 'country', 'revenue').slice(0, 10),
        byDevice: mapToSortedArray(revenueByDevice, 'device', 'revenue')
    };
}

function mapToSortedArray(map: Map<string, number>, keyName: string, valueName: string) {
    return Array.from(map.entries())
        .map(([key, value]) => ({ [keyName]: key, [valueName]: Math.round(value * 100) / 100 }))
        .sort((a, b) => (b as any)[valueName] - (a as any)[valueName]);
}
