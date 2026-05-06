import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

export class GeographyAnalytics {

    static async getTrafficByCountry(accountId: string, startDate?: string, endDate?: string) {
        try {
            const where: any = { accountId };
            if (startDate || endDate) {
                where.lastActiveAt = { gte: startDate, lte: endDate };
            }

            const groups = await prisma.analyticsSession.groupBy({
                by: ['country'],
                where,
                _count: { id: true },
                orderBy: { _count: { id: 'desc' } },
                take: 50
            });

            return groups.map(g => ({
                country: g.country || 'Unknown',
                sessions: g._count.id
            }));
        } catch (error) {
            Logger.error('[GeographyAnalytics] Traffic by country error', { error });
            return [];
        }
    }

    static async getTrafficByCity(accountId: string, country?: string, startDate?: string, endDate?: string) {
        try {
            const where: any = { accountId, country: country || { not: null } };
            if (startDate || endDate) {
                where.lastActiveAt = { gte: startDate, lte: endDate };
            }

            const groups = await prisma.analyticsSession.groupBy({
                by: ['city', 'country'],
                where,
                _count: { id: true },
                orderBy: { _count: { id: 'desc' } },
                take: 50
            });

            return groups.map(g => ({
                city: g.city || 'Unknown',
                country: g.country || 'Unknown',
                sessions: g._count.id
            }));
        } catch (error) {
            Logger.error('[GeographyAnalytics] Traffic by city error', { error });
            return [];
        }
    }

    static async getRevenueByCountry(accountId: string, startDate?: string, endDate?: string) {
        try {
            const dateFilter: any = {};
            if (startDate) dateFilter.gte = new Date(startDate);
            if (endDate) dateFilter.lte = new Date(endDate);

            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES },
                    ...(Object.keys(dateFilter).length > 0 && { dateCreated: dateFilter })
                },
                select: { wooId: true, total: true, rawData: true }
            });

            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'purchase',
                    ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
                },
                include: {
                    session: { select: { country: true, city: true } }
                }
            });

            const orderGeoMap = new Map<number, { country: string | null; city: string | null }>();
            for (const event of purchaseEvents) {
                const orderId = (event.payload as any)?.orderId;
                if (orderId && event.session) {
                    orderGeoMap.set(orderId, {
                        country: event.session.country,
                        city: event.session.city
                    });
                }
            }

            const revenueByCountry = new Map<string, { revenue: number; orders: number }>();

            for (const order of orders) {
                const total = parseFloat(String(order.total)) || 0;
                const geo = orderGeoMap.get(order.wooId);
                let country = geo?.country || (order.rawData as any)?.billing?.country || 'Unknown';

                if (!revenueByCountry.has(country)) {
                    revenueByCountry.set(country, { revenue: 0, orders: 0 });
                }
                const data = revenueByCountry.get(country)!;
                data.revenue += total;
                data.orders++;
            }

            return Array.from(revenueByCountry.entries())
                .map(([country, data]) => ({
                    country,
                    revenue: Math.round(data.revenue * 100) / 100,
                    orders: data.orders
                }))
                .sort((a, b) => b.revenue - a.revenue);
        } catch (error) {
            Logger.error('[GeographyAnalytics] Revenue by country error', { error });
            return [];
        }
    }

    static async getConversionRateByCountry(accountId: string, startDate?: string, endDate?: string) {
        try {
            const dateFilter: any = {};
            if (startDate) dateFilter.gte = new Date(startDate);
            if (endDate) dateFilter.lte = new Date(endDate);

            const sessionGroups = await prisma.analyticsSession.groupBy({
                by: ['country'],
                where: { accountId, ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter }) },
                _count: { id: true }
            });

            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'purchase',
                    ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
                },
                include: { session: { select: { country: true } } }
            });

            const purchasesByCountry = new Map<string, number>();
            for (const event of purchaseEvents) {
                const country = event.session?.country || 'Unknown';
                purchasesByCountry.set(country, (purchasesByCountry.get(country) || 0) + 1);
            }

            return sessionGroups
                .map(g => {
                    const country = g.country || 'Unknown';
                    const sessions = g._count.id;
                    const purchases = purchasesByCountry.get(country) || 0;
                    return {
                        country,
                        sessions,
                        purchases,
                        conversionRate: sessions > 0 ? Math.round((purchases / sessions) * 10000) / 100 : 0
                    };
                })
                .sort((a, b) => b.sessions - a.sessions)
                .slice(0, 50);
        } catch (error) {
            Logger.error('[GeographyAnalytics] Conversion rate by country error', { error });
            return [];
        }
    }
}
