/**
 * Revenue Metrics
 * 
 * Revenue analytics with attribution tracking.
 * Extracted from MetricsService for modularity.
 */

import { prisma } from '../../utils/prisma';

/**
 * Calculate proper date range based on days parameter and timezone.
 * Uses the account's timezone to correctly determine "today" boundaries.
 */
function getDateRangeForDays(days: number, timezone: string = 'Australia/Sydney'): { startDate: Date; endDate: Date } {
    const now = new Date();

    // Helper: Get date components in the specified timezone
    const getDatePartsInTz = (date: Date, tz: string) => {
        const formatter = new Intl.DateTimeFormat('en-AU', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(date);
        const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0');
        return { year: get('year'), month: get('month') - 1, day: get('day') };
    };

    // Helper: Create a Date from timezone-local midnight
    const getMidnightInTz = (year: number, month: number, day: number, tz: string): Date => {
        // Create a date string in the target timezone and parse it
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;
        // Use a temp date to find the UTC offset for this timezone at this date
        const tempDate = new Date(dateStr + 'Z');
        const tzOffset = new Date(tempDate.toLocaleString('en-US', { timeZone: tz })).getTime() -
            new Date(tempDate.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
        return new Date(tempDate.getTime() - tzOffset);
    };

    if (days === 1) {
        // Today: from midnight in user's timezone to now
        const { year, month, day } = getDatePartsInTz(now, timezone);
        const startDate = getMidnightInTz(year, month, day, timezone);
        return { startDate, endDate: now };
    } else if (days === -1) {
        // Yesterday: full day in user's timezone
        const { year, month, day } = getDatePartsInTz(now, timezone);
        const yesterdayDate = new Date(year, month, day - 1);
        const startDate = getMidnightInTz(yesterdayDate.getFullYear(), yesterdayDate.getMonth(), yesterdayDate.getDate(), timezone);
        const endDate = getMidnightInTz(year, month, day, timezone);
        endDate.setMilliseconds(endDate.getMilliseconds() - 1); // End of yesterday
        return { startDate, endDate };
    } else {
        // X days ago: simple offset from now
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return { startDate, endDate: now };
    }
}

/**
 * Get revenue analytics: AOV, total, by source.
 * Uses WooCommerce orders as the primary source of truth for revenue totals,
 * enriched with analytics session data for attribution when available.
 * Days parameter is capped at 365 to prevent unbounded queries.
 */
export async function getRevenue(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
    // Cap days to prevent unbounded queries, but preserve special values (-1 = yesterday)
    const MAX_DAYS = 365;
    const effectiveDays = days === -1 ? -1 : Math.min(Math.max(days, 1), MAX_DAYS);
    const { startDate, endDate } = getDateRangeForDays(effectiveDays, timezone);

    // Primary source: WooCommerce orders
    const orders = await prisma.wooOrder.findMany({
        where: {
            accountId,
            dateCreated: { gte: startDate, lte: endDate },
            status: { in: ['completed', 'processing'] }
        },
        select: { wooId: true, total: true, rawData: true }
    });

    // Secondary source: Analytics sessions for attribution
    const purchaseEvents = await prisma.analyticsEvent.findMany({
        where: {
            session: { accountId },
            type: 'purchase',
            createdAt: { gte: startDate, lte: endDate }
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
