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
 * Calculate proper date range based on days parameter.
 * - days = 1: Today only (from midnight local time to now)
 * - days = -1: Yesterday only (full yesterday in local time)
 * - days > 1: Last N days
 */
function getDateRangeForDays(days: number): { startDate: Date; endDate: Date } {
    const now = new Date();

    if (days === 1) {
        // Today: from start of today to now
        const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        return { startDate, endDate: now };
    } else if (days === -1) {
        // Yesterday: full day
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0);
        const endDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
        return { startDate, endDate };
    } else {
        // Last N days: from N days ago to now
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return { startDate, endDate: now };
    }
}

/**
 * Get aggregated stats for dashboard.
 */
export async function getStats(accountId: string, days: number = 30) {
    const { startDate, endDate } = getDateRangeForDays(days);

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
export async function getFunnel(accountId: string, days: number = 30) {
    const { startDate, endDate } = getDateRangeForDays(days);

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
export async function getAttribution(accountId: string, days: number = 30) {
    const { startDate, endDate } = getDateRangeForDays(days);

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
export async function getAbandonmentRate(accountId: string, days: number = 30) {
    const { startDate, endDate } = getDateRangeForDays(days);

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
