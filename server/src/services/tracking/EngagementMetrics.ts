/**
 * Engagement Metrics
 * 
 * User engagement analytics: searches, exit pages.
 * Extracted from MetricsService for modularity.
 */

import { prisma } from '../../utils/prisma';
import { getDateRangeForDays } from '../../utils/dateRange';

interface TrackingDateRange {
    startDate: Date;
    endDate: Date;
}

/**
 * Get search analytics: top queries.
 * Handles both 'search' events AND pageview events with page_type='search'.
 */
export async function getSearches(accountId: string, days: number = 30, dateRange?: TrackingDateRange) {
    const { startDate, endDate } = dateRange || getDateRangeForDays(days);

    const events = await prisma.analyticsEvent.findMany({
        where: {
            session: { accountId },
            type: { in: ['search', 'pageview'] },
            createdAt: { gte: startDate, lte: endDate }
        },
        select: { type: true, payload: true }
    });

    const queryCounts = new Map<string, number>();
    let searchCount = 0;

    for (const event of events) {
        const payload = event.payload as any;
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
 */
export async function getExitPages(accountId: string, days: number = 30, dateRange?: TrackingDateRange) {
    const { startDate, endDate } = dateRange || getDateRangeForDays(days);

    const sessions = await prisma.analyticsSession.findMany({
        where: { accountId, createdAt: { gte: startDate, lte: endDate } },
        select: { currentPath: true }
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
