import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

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
    async getAOVTrend(accountId: string, days: number = 30): Promise<AOVPoint[]> {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES },
                    dateCreated: { gte: startDate, lte: endDate }
                },
                select: {
                    dateCreated: true,
                    total: true
                },
                orderBy: { dateCreated: 'asc' }
            });

            const dailyMap = new Map<string, { total: number; count: number }>();

            for (const order of orders) {
                const dateKey = order.dateCreated.toISOString().split('T')[0];
                const existing = dailyMap.get(dateKey) || { total: 0, count: 0 };
                existing.total += Number(order.total) || 0;
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
            return [];
        }
    }

    async getAOVComparison(accountId: string, days: number = 30): Promise<AOVComparison> {
        try {
            const now = new Date();
            const currentStart = new Date();
            currentStart.setDate(currentStart.getDate() - days);

            const previousEnd = new Date(currentStart);
            const previousStart = new Date(previousEnd);
            previousStart.setDate(previousStart.getDate() - days);

            const [currentOrders, previousOrders] = await Promise.all([
                prisma.wooOrder.findMany({
                    where: {
                        accountId,
                        status: { in: REVENUE_STATUSES },
                        dateCreated: { gte: currentStart, lte: now }
                    },
                    select: { total: true }
                }),
                prisma.wooOrder.findMany({
                    where: {
                        accountId,
                        status: { in: REVENUE_STATUSES },
                        dateCreated: { gte: previousStart, lte: previousEnd }
                    },
                    select: { total: true }
                })
            ]);

            const currentRevenue = currentOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
            const previousRevenue = previousOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

            const current = currentOrders.length > 0 ? Math.round((currentRevenue / currentOrders.length) * 100) / 100 : 0;
            const previous = previousOrders.length > 0 ? Math.round((previousRevenue / previousOrders.length) * 100) / 100 : 0;

            const change = Math.round((current - previous) * 100) / 100;
            const changePercent = previous > 0 ? Math.round(((current - previous) / previous) * 10000) / 100 : 0;

            return { current, previous, change, changePercent };
        } catch (error) {
            Logger.error('[AOVService] AOV comparison error', { error, accountId });
            return { current: 0, previous: 0, change: 0, changePercent: 0 };
        }
    }
}

export const aovService = new AOVService();
