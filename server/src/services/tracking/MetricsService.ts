/**
 * Aggregated analytics metrics service.
 *
 * Provides dashboard statistics, funnel analysis, revenue tracking,
 * attribution data, abandonment rates, search analytics, and exit page analysis.
 */

import { prisma } from '../../utils/prisma';

/**
 * Get aggregated stats for dashboard.
 *
 * @param accountId - The account ID to query
 * @param days - Number of days to look back (default: 30)
 * @returns Aggregated stats including countries, devices, browsers, and session duration
 */
export async function getStats(accountId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const sessions = await prisma.analyticsSession.findMany({
        where: {
            accountId,
            createdAt: { gte: startDate }
        },
        select: {
            country: true,
            deviceType: true,
            browser: true,
            os: true,
            createdAt: true,
            lastActiveAt: true
        }
    });

    // Aggregate by country
    const countryMap = new Map<string, number>();
    const deviceMap = new Map<string, number>();
    const browserMap = new Map<string, number>();

    let totalDuration = 0;
    let sessionCount = 0;

    for (const s of sessions) {
        if (s.country) {
            countryMap.set(s.country, (countryMap.get(s.country) || 0) + 1);
        }
        if (s.deviceType) {
            deviceMap.set(s.deviceType, (deviceMap.get(s.deviceType) || 0) + 1);
        }
        if (s.browser) {
            browserMap.set(s.browser, (browserMap.get(s.browser) || 0) + 1);
        }

        // Calculate session duration
        if (s.createdAt && s.lastActiveAt) {
            const duration = new Date(s.lastActiveAt).getTime() - new Date(s.createdAt).getTime();
            if (duration > 0) {
                totalDuration += duration;
                sessionCount++;
            }
        }
    }

    return {
        countries: Array.from(countryMap.entries())
            .map(([country, sessions]) => ({ country, sessions }))
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 10),
        devices: Array.from(deviceMap.entries())
            .map(([type, sessions]) => ({ type, sessions }))
            .sort((a, b) => b.sessions - a.sessions),
        browsers: Array.from(browserMap.entries())
            .map(([name, sessions]) => ({ name, sessions }))
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 10),
        totalSessions: sessions.length,
        avgSessionDuration: sessionCount > 0 ? Math.round(totalDuration / sessionCount / 1000) : 0 // seconds
    };
}

/**
 * Get funnel data for dashboard.
 *
 * @param accountId - The account ID to query
 * @param days - Number of days to look back (default: 30)
 * @returns Funnel stages with unique session counts
 */
export async function getFunnel(accountId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const events = await prisma.analyticsEvent.findMany({
        where: {
            session: { accountId },
            createdAt: { gte: startDate }
        },
        select: {
            type: true,
            sessionId: true
        }
    });

    // Count unique sessions for each stage
    const productViews = new Set<string>();
    const addToCarts = new Set<string>();
    const checkouts = new Set<string>();
    const purchases = new Set<string>();

    for (const event of events) {
        if (event.type === 'product_view' || event.type === 'pageview') {
            productViews.add(event.sessionId);
        }
        if (event.type === 'add_to_cart') {
            addToCarts.add(event.sessionId);
        }
        if (event.type === 'checkout_start') {
            checkouts.add(event.sessionId);
        }
        if (event.type === 'purchase') {
            purchases.add(event.sessionId);
        }
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
 * Get revenue analytics: AOV, total, by source.
 * Falls back to Elasticsearch order data if no analytics purchase events exist.
 *
 * @param accountId - The account ID to query
 * @param days - Number of days to look back (default: 30)
 * @returns Revenue breakdown by source, country, and device
 */
export async function getRevenue(accountId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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

    let totalRevenue = 0;
    let orderCount = 0;
    const revenueByFirstTouch = new Map<string, number>();
    const revenueByLastTouch = new Map<string, number>();
    const revenueByCountry = new Map<string, number>();
    const revenueByDevice = new Map<string, number>();

    // If we have analytics purchase events, use them
    if (purchaseEvents.length > 0) {
        for (const event of purchaseEvents) {
            const total = (event.payload as any)?.total || 0;
            totalRevenue += total;

            // @ts-ignore - Prisma include type inference not working correctly with select
            const session = event.session as { firstTouchSource: string | null; lastTouchSource: string | null; country: string | null; deviceType: string | null };
            const firstTouch = session?.firstTouchSource || 'direct';
            const lastTouch = session?.lastTouchSource || 'direct';
            const country = session?.country || 'Unknown';
            const device = session?.deviceType || 'unknown';

            revenueByFirstTouch.set(firstTouch, (revenueByFirstTouch.get(firstTouch) || 0) + total);
            revenueByLastTouch.set(lastTouch, (revenueByLastTouch.get(lastTouch) || 0) + total);
            revenueByCountry.set(country, (revenueByCountry.get(country) || 0) + total);
            revenueByDevice.set(device, (revenueByDevice.get(device) || 0) + total);
        }
        orderCount = purchaseEvents.length;
    } else {
        // Fallback: Use WooCommerce orders from database when no analytics events exist
        const orders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                dateCreated: { gte: startDate },
                status: { in: ['completed', 'processing', 'on-hold'] }
            },
            select: {
                total: true,
                rawData: true
            }
        });

        for (const order of orders) {
            const total = parseFloat(String(order.total)) || 0;
            totalRevenue += total;

            // Extract billing country from rawData JSON
            const rawDataObj = order.rawData as any;
            const country = rawDataObj?.billing?.country || 'Unknown';
            revenueByCountry.set(country, (revenueByCountry.get(country) || 0) + total);

            // For fallback orders without analytics, mark as 'direct'
            revenueByFirstTouch.set('direct', (revenueByFirstTouch.get('direct') || 0) + total);
            revenueByLastTouch.set('direct', (revenueByLastTouch.get('direct') || 0) + total);
            revenueByDevice.set('unknown', (revenueByDevice.get('unknown') || 0) + total);
        }
        orderCount = orders.length;
    }

    const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

    return {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        orderCount,
        aov: Math.round(aov * 100) / 100,
        byFirstTouch: Array.from(revenueByFirstTouch.entries())
            .map(([source, revenue]) => ({ source, revenue: Math.round(revenue * 100) / 100 }))
            .sort((a, b) => b.revenue - a.revenue),
        byLastTouch: Array.from(revenueByLastTouch.entries())
            .map(([source, revenue]) => ({ source, revenue: Math.round(revenue * 100) / 100 }))
            .sort((a, b) => b.revenue - a.revenue),
        byCountry: Array.from(revenueByCountry.entries())
            .map(([country, revenue]) => ({ country, revenue: Math.round(revenue * 100) / 100 }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10),
        byDevice: Array.from(revenueByDevice.entries())
            .map(([device, revenue]) => ({ device, revenue: Math.round(revenue * 100) / 100 }))
    };
}

/**
 * Get attribution data: first-touch vs last-touch comparison.
 *
 * @param accountId - The account ID to query
 * @param days - Number of days to look back (default: 30)
 * @returns Attribution counts by source for both first and last touch
 */
export async function getAttribution(accountId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const sessions = await prisma.analyticsSession.findMany({
        where: {
            accountId,
            createdAt: { gte: startDate }
        },
        select: {
            firstTouchSource: true,
            lastTouchSource: true,
            cartValue: true
        }
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
        firstTouch: Array.from(firstTouchCounts.entries())
            .map(([source, count]) => ({ source, count }))
            .sort((a, b) => b.count - a.count),
        lastTouch: Array.from(lastTouchCounts.entries())
            .map(([source, count]) => ({ source, count }))
            .sort((a, b) => b.count - a.count),
        totalSessions: sessions.length
    };
}

/**
 * Get cart abandonment rate.
 *
 * @param accountId - The account ID to query
 * @param days - Number of days to look back (default: 30)
 * @returns Abandonment metrics
 */
export async function getAbandonmentRate(accountId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const events = await prisma.analyticsEvent.findMany({
        where: {
            session: { accountId },
            createdAt: { gte: startDate },
            type: { in: ['add_to_cart', 'purchase'] }
        },
        select: {
            type: true,
            sessionId: true
        }
    });

    const addedToCart = new Set<string>();
    const purchased = new Set<string>();

    for (const event of events) {
        if (event.type === 'add_to_cart') addedToCart.add(event.sessionId);
        if (event.type === 'purchase') purchased.add(event.sessionId);
    }

    const abandoned = [...addedToCart].filter(id => !purchased.has(id));
    const abandonmentRate = addedToCart.size > 0
        ? (abandoned.length / addedToCart.size) * 100
        : 0;

    return {
        addedToCartCount: addedToCart.size,
        purchasedCount: purchased.size,
        abandonedCount: abandoned.length,
        abandonmentRate: Math.round(abandonmentRate * 10) / 10
    };
}

/**
 * Get search analytics: top queries.
 * Handles both dedicated 'search' events AND pageview events with page_type='search'.
 *
 * @param accountId - The account ID to query
 * @param days - Number of days to look back (default: 30)
 * @returns Top search queries with counts
 */
export async function getSearches(accountId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Query both 'search' type events AND 'pageview' events (which may contain search data)
    const events = await prisma.analyticsEvent.findMany({
        where: {
            session: { accountId },
            type: { in: ['search', 'pageview'] },
            createdAt: { gte: startDate }
        },
        select: {
            type: true,
            payload: true
        }
    });

    const queryCounts = new Map<string, number>();
    let searchCount = 0;

    for (const event of events) {
        const payload = event.payload as any;

        // For 'search' events, extract query directly
        // For 'pageview' events, check if page_type is 'search'
        let query = '';

        if (event.type === 'search') {
            query = (payload?.searchQuery || payload?.term || '').toLowerCase().trim();
        } else if (event.type === 'pageview' && payload?.page_type === 'search') {
            query = (payload?.searchQuery || '').toLowerCase().trim();
        }

        if (query) {
            queryCounts.set(query, (queryCounts.get(query) || 0) + 1);
            searchCount++;
        }
    }

    return {
        topQueries: Array.from(queryCounts.entries())
            .map(([query, count]) => ({ query, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20),
        totalSearches: searchCount
    };
}

/**
 * Get exit pages: where users leave.
 *
 * @param accountId - The account ID to query
 * @param days - Number of days to look back (default: 30)
 * @returns Top exit pages with counts
 */
export async function getExitPages(accountId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const sessions = await prisma.analyticsSession.findMany({
        where: {
            accountId,
            createdAt: { gte: startDate }
        },
        select: {
            currentPath: true
        }
    });

    const exitCounts = new Map<string, number>();
    for (const s of sessions) {
        if (s.currentPath) {
            exitCounts.set(s.currentPath, (exitCounts.get(s.currentPath) || 0) + 1);
        }
    }

    return {
        topExitPages: Array.from(exitCounts.entries())
            .map(([page, count]) => ({ page, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20)
    };
}
