/**
 * Aggregated Analytics Metrics Service
 * 
 * Core metrics: stats, funnel, attribution, abandonment.
 * Revenue and engagement metrics are delegated to specialized modules.
 */

import { prisma } from '../../utils/prisma';

// Re-export delegated modules for backward compatibility
export { getRevenue } from './RevenueMetrics';
export { getSearches, getExitPages } from './EngagementMetrics';

/**
 * Calculate proper date range based on days parameter and timezone.
 * Uses the user's timezone to correctly determine "today" boundaries.
 * - days = 1: Today only (from midnight in user's timezone to now)
 * - days = -1: Yesterday only (full yesterday in user's timezone)
 * - days > 1: Last N days
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
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;
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
        endDate.setMilliseconds(endDate.getMilliseconds() - 1);
        return { startDate, endDate };
    } else {
        // Last N days: simple offset from now
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return { startDate, endDate: now };
    }
}

/**
 * Get aggregated stats for dashboard.
 */
export async function getStats(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
    const { startDate, endDate } = getDateRangeForDays(days, timezone);

    const sessions = await prisma.analyticsSession.findMany({
        where: { accountId, createdAt: { gte: startDate, lte: endDate } },
        select: {
            country: true, deviceType: true, browser: true, os: true,
            createdAt: true, lastActiveAt: true
        }
    });

    const countryMap = new Map<string, number>();
    const deviceMap = new Map<string, number>();
    const browserMap = new Map<string, number>();

    let totalDuration = 0;
    let sessionCount = 0;

    for (const s of sessions) {
        if (s.country) countryMap.set(s.country, (countryMap.get(s.country) || 0) + 1);
        if (s.deviceType) deviceMap.set(s.deviceType, (deviceMap.get(s.deviceType) || 0) + 1);
        if (s.browser) browserMap.set(s.browser, (browserMap.get(s.browser) || 0) + 1);

        if (s.createdAt && s.lastActiveAt) {
            const duration = new Date(s.lastActiveAt).getTime() - new Date(s.createdAt).getTime();
            if (duration > 0) { totalDuration += duration; sessionCount++; }
        }
    }

    return {
        countries: mapToArray(countryMap, 'country', 'sessions').slice(0, 10),
        devices: mapToArray(deviceMap, 'type', 'sessions'),
        browsers: mapToArray(browserMap, 'name', 'sessions').slice(0, 10),
        totalSessions: sessions.length,
        avgSessionDuration: sessionCount > 0 ? Math.round(totalDuration / sessionCount / 1000) : 0
    };
}

/**
 * Get funnel data for dashboard.
 */
export async function getFunnel(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
    const { startDate, endDate } = getDateRangeForDays(days, timezone);

    const events = await prisma.analyticsEvent.findMany({
        where: { session: { accountId }, createdAt: { gte: startDate, lte: endDate } },
        select: { type: true, sessionId: true }
    });

    const productViews = new Set<string>();
    const addToCarts = new Set<string>();
    const checkouts = new Set<string>();
    const purchases = new Set<string>();

    for (const event of events) {
        if (event.type === 'product_view' || event.type === 'pageview') productViews.add(event.sessionId);
        if (event.type === 'add_to_cart') addToCarts.add(event.sessionId);
        if (event.type === 'checkout_start') checkouts.add(event.sessionId);
        if (event.type === 'purchase') purchases.add(event.sessionId);
    }

    return {
        stages: [
            { name: 'Product Views', count: productViews.size },
            { name: 'Add to Cart', count: addToCarts.size },
            { name: 'Checkout', count: checkouts.size },
            { name: 'Purchase', count: purchases.size }
        ]
    };
}

/**
 * Get attribution data: first-touch vs last-touch.
 */
export async function getAttribution(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
    const { startDate, endDate } = getDateRangeForDays(days, timezone);

    const sessions = await prisma.analyticsSession.findMany({
        where: { accountId, createdAt: { gte: startDate, lte: endDate } },
        select: { firstTouchSource: true, lastTouchSource: true, cartValue: true }
    });

    const firstTouchCounts = new Map<string, number>();
    const lastTouchCounts = new Map<string, number>();

    for (const s of sessions) {
        const first = s.firstTouchSource || 'direct';
        const last = s.lastTouchSource || 'direct';
        firstTouchCounts.set(first, (firstTouchCounts.get(first) || 0) + 1);
        lastTouchCounts.set(last, (lastTouchCounts.get(last) || 0) + 1);
    }

    return {
        firstTouch: mapToArray(firstTouchCounts, 'source', 'count'),
        lastTouch: mapToArray(lastTouchCounts, 'source', 'count'),
        totalSessions: sessions.length
    };
}

/**
 * Get cart abandonment rate.
 */
export async function getAbandonmentRate(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
    const { startDate, endDate } = getDateRangeForDays(days, timezone);

    const events = await prisma.analyticsEvent.findMany({
        where: {
            session: { accountId },
            createdAt: { gte: startDate, lte: endDate },
            type: { in: ['add_to_cart', 'purchase'] }
        },
        select: { type: true, sessionId: true }
    });

    const addedToCart = new Set<string>();
    const purchased = new Set<string>();

    for (const event of events) {
        if (event.type === 'add_to_cart') addedToCart.add(event.sessionId);
        if (event.type === 'purchase') purchased.add(event.sessionId);
    }

    const abandoned = [...addedToCart].filter(id => !purchased.has(id));
    const rate = addedToCart.size > 0 ? (abandoned.length / addedToCart.size) * 100 : 0;

    return {
        addedToCartCount: addedToCart.size,
        purchasedCount: purchased.size,
        abandonedCount: abandoned.length,
        abandonmentRate: Math.round(rate * 10) / 10
    };
}

function mapToArray(map: Map<string, number>, keyName: string, valueName: string) {
    return Array.from(map.entries())
        .map(([key, value]) => ({ [keyName]: key, [valueName]: value }))
        .sort((a, b) => (b as any)[valueName] - (a as any)[valueName]);
}
