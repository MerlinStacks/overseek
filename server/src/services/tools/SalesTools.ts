import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class SalesTools {
    static async getSalesAnalytics(accountId: string, period: string) {
        const now = new Date();
        let startDate = new Date();

        switch (period) {
            case 'today':
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'yesterday':
                startDate.setDate(startDate.getDate() - 1);
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'last_7_days':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'last_30_days':
                startDate.setDate(startDate.getDate() - 30);
                break;
            case 'this_month':
                startDate.setDate(1);
                startDate.setHours(0, 0, 0, 0);
                break;
        }

        const isYesterday = period === 'yesterday';
        const upperDate = isYesterday ? new Date(startDate.getTime() + 86400000) : now;

        try {
            const aggregations = await prisma.wooOrder.aggregate({
                where: {
                    accountId,
                    dateCreated: {
                        gte: startDate,
                        lt: upperDate
                    },
                    status: 'completed'
                },
                _sum: {
                    total: true
                },
                _count: {
                    id: true
                }
            });

            return {
                period,
                total_sales: aggregations._sum.total || 0,
                order_count: aggregations._count.id || 0,
                start_date: startDate.toISOString().split('T')[0]
            };

        } catch (error) {
            Logger.error('Tool Error (getSalesAnalytics)', { error });
            return "Failed to calculate analytics.";
        }
    }
}
