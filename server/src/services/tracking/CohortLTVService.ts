/**
 * Cohort analysis and Lifetime Value (LTV) calculations.
 *
 * Provides methods for analyzing customer retention by cohort and
 * calculating customer lifetime value metrics.
 */

import { prisma } from '../../utils/prisma';

/**
 * Get the start of the week (Monday) for a given date.
 *
 * @param date - The date to get the week start for
 * @returns Date representing the start of the week
 */
function getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Get cohort analysis: retention by signup week.
 *
 * @param accountId - The account ID to query
 * @returns Cohort data with retention rates per week
 */
export async function getCohorts(accountId: string) {
    const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000);

    const sessions = await prisma.analyticsSession.findMany({
        where: {
            accountId,
            createdAt: { gte: eightWeeksAgo }
        },
        select: {
            visitorId: true,
            createdAt: true,
            lastActiveAt: true
        }
    });

    // Group by cohort week
    const cohorts = new Map<string, { visitors: Set<string>, retained: Map<number, Set<string>> }>();

    for (const s of sessions) {
        const cohortWeek = getWeekStart(s.createdAt);
        const cohortKey = cohortWeek.toISOString().split('T')[0];

        if (!cohorts.has(cohortKey)) {
            cohorts.set(cohortKey, { visitors: new Set(), retained: new Map() });
        }

        cohorts.get(cohortKey)!.visitors.add(s.visitorId);

        // Calculate which week they were last active
        const weeksSinceStart = Math.floor((s.lastActiveAt.getTime() - cohortWeek.getTime()) / (7 * 24 * 60 * 60 * 1000));
        for (let w = 0; w <= weeksSinceStart && w <= 7; w++) {
            if (!cohorts.get(cohortKey)!.retained.has(w)) {
                cohorts.get(cohortKey)!.retained.set(w, new Set());
            }
            cohorts.get(cohortKey)!.retained.get(w)!.add(s.visitorId);
        }
    }

    return {
        cohorts: Array.from(cohorts.entries()).map(([week, data]) => ({
            week,
            totalVisitors: data.visitors.size,
            retention: Array.from(data.retained.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([weekNum, visitors]) => ({
                    week: weekNum,
                    count: visitors.size,
                    rate: Math.round((visitors.size / data.visitors.size) * 100)
                }))
        })).sort((a, b) => a.week.localeCompare(b.week))
    };
}

/**
 * Calculate LTV for customers.
 *
 * @param accountId - The account ID to query
 * @returns LTV metrics including average, repeat rate, and top customers
 */
export async function getLTV(accountId: string) {
    const purchaseEvents = await prisma.analyticsEvent.findMany({
        where: {
            session: { accountId },
            type: 'purchase'
        },
        include: {
            session: {
                select: { wooCustomerId: true, email: true }
            }
        }
    });

    const customerRevenue = new Map<string, number>();
    const customerOrders = new Map<string, number>();

    for (const event of purchaseEvents) {
        // Session data is properly included from the Prisma query above
        const session = event.session as { wooCustomerId: number | null; email: string | null } | null;
        if (!session) continue;

        const customerId = (session.wooCustomerId?.toString()) || session.email || 'anonymous';
        const total = (event.payload as any)?.total || 0;

        customerRevenue.set(customerId, (customerRevenue.get(customerId) || 0) + total);
        customerOrders.set(customerId, (customerOrders.get(customerId) || 0) + 1);
    }

    const ltvValues = Array.from(customerRevenue.values());
    const avgLTV = ltvValues.length > 0
        ? ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length
        : 0;

    const repeatCustomers = [...customerOrders.values()].filter(c => c > 1).length;
    const repeatRate = customerOrders.size > 0
        ? (repeatCustomers / customerOrders.size) * 100
        : 0;

    return {
        avgLTV: Math.round(avgLTV * 100) / 100,
        totalCustomers: customerOrders.size,
        repeatCustomers,
        repeatRate: Math.round(repeatRate * 10) / 10,
        topCustomers: Array.from(customerRevenue.entries())
            .map(([id, ltv]) => ({ customerId: id, ltv: Math.round(ltv * 100) / 100, orders: customerOrders.get(id) || 0 }))
            .sort((a, b) => b.ltv - a.ltv)
            .slice(0, 10)
    };
}

/**
 * Calculate purchase intent score for a session.
 *
 * @param session - The session object with activity data
 * @returns Score from 0-100 indicating purchase likelihood
 */
export function calculatePurchaseIntent(session: any): number {
    let score = 0;

    // Pageviews (max 20 points)
    score += Math.min((session.totalVisits || 0) * 2, 20);

    // Has items in cart (30 points)
    if (session.cartValue && session.cartValue > 0) score += 30;

    // Cart value (max 20 points)
    score += Math.min((session.cartValue || 0) / 10, 20);

    // Is returning visitor (15 points)
    if (session.isReturning) score += 15;

    // Viewed checkout (15 points)
    if (session.currentPath?.includes('checkout')) score += 15;

    return Math.min(Math.round(score), 100);
}
