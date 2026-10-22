import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { getDateRangeForDays } from '../../utils/dateRange';
import { getRevenueSettings, orderRevenue, revenueStatusFilter } from '../../utils/revenue';

interface AOVPoint {
    date: string;
    aov: number;
    orders: number;
}

interface AOVComparison {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
}

export class AOVService {
    async getAOVTrend(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney', options: { throwOnError?: boolean } = {}): Promise<AOVPoint[]> {
        try {
            const settings = await getRevenueSettings(accountId, timezone);
            timezone = settings.timezone;
            const { startDate, endDate } = getDateRangeForDays(days, timezone);
            const dateFormatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
            });

            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: revenueStatusFilter,
                    dateCreated: { gte: startDate, lte: endDate }
                },
                select: {
                    dateCreated: true,
                    total: true,
                    rawData: true
                },
                orderBy: { dateCreated: 'asc' }
            });

            const dailyMap = new Map<string, { total: number; count: number }>();

            for (const order of orders) {
                const dateKey = dateFormatter.format(order.dateCreated);
                const existing = dailyMap.get(dateKey) || { total: 0, count: 0 };
                existing.total += orderRevenue(order, settings.taxInclusive);
                existing.count++;
                dailyMap.set(dateKey, existing);
            }

            return Array.from(dailyMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, data]) => ({
                    date,
                    aov: data.count > 0 ? Math.round((data.total / data.count) * 100) / 100 : 0,
                    orders: data.count
                }));
        } catch (error) {
            Logger.error('[AOVService] AOV trend error', { error, accountId });
            if (options.throwOnError) throw error;
            return [];
        }
    }

    async getAOVComparison(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney', options: { throwOnError?: boolean } = {}): Promise<AOVComparison> {
        try {
            const settings = await getRevenueSettings(accountId, timezone);
            timezone = settings.timezone;
            const { startDate: currentStart, endDate: now } = getDateRangeForDays(days, timezone);
            // Yesterday compares with the preceding calendar day; other ranges
            // compare with the immediately preceding, equally sized window.
            const previousEnd = new Date(currentStart.getTime() - 1);
            const previousStart = days === -1
                ? getDateRangeForDays(-1, timezone, currentStart).startDate
                : new Date(currentStart.getTime() - (now.getTime() - currentStart.getTime()));

            const [currentOrders, previousOrders] = await Promise.all([
                prisma.wooOrder.findMany({
                    where: {
                        accountId,
                        status: revenueStatusFilter,
                        dateCreated: { gte: currentStart, lte: now }
                    },
                    select: { total: true, rawData: true }
                }),
                prisma.wooOrder.findMany({
                    where: {
                        accountId,
                        status: revenueStatusFilter,
                        dateCreated: { gte: previousStart, lte: previousEnd }
                    },
                    select: { total: true, rawData: true }
                })
            ]);

            const currentRevenue = currentOrders.reduce((sum, o) => sum + orderRevenue(o, settings.taxInclusive), 0);
            const previousRevenue = previousOrders.reduce((sum, o) => sum + orderRevenue(o, settings.taxInclusive), 0);

            const current = currentOrders.length > 0 ? Math.round((currentRevenue / currentOrders.length) * 100) / 100 : 0;
            const previous = previousOrders.length > 0 ? Math.round((previousRevenue / previousOrders.length) * 100) / 100 : 0;

            const change = Math.round((current - previous) * 100) / 100;
            const changePercent = previous > 0 ? Math.round(((current - previous) / previous) * 10000) / 100 : 0;

            return { current, previous, change, changePercent };
        } catch (error) {
            Logger.error('[AOVService] AOV comparison error', { error, accountId });
            if (options.throwOnError) throw error;
            return { current: 0, previous: 0, change: 0, changePercent: 0 };
        }
    }
}

export const aovService = new AOVService();
