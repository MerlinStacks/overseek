import { NON_REVENUE_ORDER_STATUSES } from '../constants/orderStatus';
import { prisma } from './prisma';
import { normalizeTimezone } from './timezone';

/** Match the dashboard's revenue policy, including custom order statuses. */
export const revenueStatusFilter = {
    notIn: [...new Set(NON_REVENUE_ORDER_STATUSES.map(status => status.toLowerCase()))]
};

export async function getRevenueSettings(accountId: string, fallbackTimezone: string) {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { timezone: true, revenueTaxInclusive: true }
    });
    return {
        timezone: normalizeTimezone(account?.timezone || fallbackTimezone),
        taxInclusive: account?.revenueTaxInclusive ?? true
    };
}

export function orderRevenue(order: { total: unknown; rawData?: unknown }, taxInclusive: boolean): number {
    const total = Number(order.total) || 0;
    if (taxInclusive) return total;
    const rawData = order.rawData as { total_tax?: unknown } | null;
    const tax = Number(rawData?.total_tax ?? 0);
    return total - (Number.isFinite(tax) ? tax : 0);
}
