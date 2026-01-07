/**
 * Live analytics service for real-time visitor and cart tracking.
 *
 * Provides methods to retrieve currently active visitors and carts for
 * live dashboard views.
 */

import { prisma } from '../../utils/prisma';
import { isBot } from './TrafficAnalyzer';

/**
 * Get Live Visitors (Active in last 3 mins).
 * Filters out bots and sessions without userAgent.
 *
 * @param accountId - The account ID to query
 * @returns Array of active visitor sessions (max 50)
 */
export async function getLiveVisitors(accountId: string) {
    const threeMinsAgo = new Date(Date.now() - 3 * 60 * 1000);

    const sessions = await prisma.analyticsSession.findMany({
        where: {
            accountId,
            lastActiveAt: {
                gte: threeMinsAgo
            },
            // Exclude sessions with no userAgent (likely bots or server-side requests)
            userAgent: {
                not: null
            }
        },
        orderBy: {
            lastActiveAt: 'desc'
        },
        take: 100 // Fetch more initially, we'll filter further
    });

    // Post-filter to catch any bots that slipped through ingestion
    // Also filter out empty userAgent strings
    const filteredSessions = sessions.filter(session => {
        if (!session.userAgent || session.userAgent.trim() === '') return false;
        return !isBot(session.userAgent);
    });

    return filteredSessions.slice(0, 50); // Cap at 50 for live view
}

/**
 * Get Active Carts (Live sessions with cart items).
 * Returns carts from sessions active within the last hour.
 *
 * @param accountId - The account ID to query
 * @returns Array of sessions with cart value > 0
 */
export async function getLiveCarts(accountId: string) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    return prisma.analyticsSession.findMany({
        where: {
            accountId,
            cartValue: {
                gt: 0
            },
            lastActiveAt: {
                gte: oneHourAgo
            }
        },
        orderBy: {
            cartValue: 'desc'
        }
    });
}

/**
 * Get Session History - all events for a specific session.
 *
 * @param sessionId - The session ID to query
 * @returns Array of analytics events in descending order by creation time
 */
export async function getSessionHistory(sessionId: string) {
    return prisma.analyticsEvent.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' }
    });
}
