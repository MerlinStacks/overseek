import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class OrderTools {
    static async getRecentOrders(accountId: string, limit: number = 5, status?: string) {
        const query: any = {
            where: { accountId },
            take: Math.min(limit || 5, 20),
            orderBy: { dateCreated: 'desc' },
            select: {
                id: true,
                number: true,
                status: true,
                total: true,
                currency: true,
                dateCreated: true,
                billing: true
            }
        };

        if (status) {
            query.where.status = status;
        }

        try {
            const orders = await prisma.wooOrder.findMany(query);
            if (!orders.length) return "No orders found.";

            return orders.map((o: any) => ({
                id: o.number,
                status: o.status,
                total: `${o.currency} ${o.total}`,
                date: o.dateCreated?.toISOString().split('T')[0],
                customer: `${o.billing?.first_name} ${o.billing?.last_name}`
            }));
        } catch (error) {
            Logger.error('Tool Error (getRecentOrders)', { error });
            return "Failed to retrieve orders.";
        }
    }
}
