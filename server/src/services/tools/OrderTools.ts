import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import type { Prisma } from '@prisma/client';
import { record, text, toolLimit } from './toolData';

export class OrderTools {
    static async getRecentOrders(accountId: string, limit: number = 5, status?: string) {
        if (!text(accountId)) return "Account ID required.";
        const query = {
            where: { accountId },
            take: toolLimit(limit, 20),
            orderBy: [{ dateCreated: 'desc' }, { id: 'asc' }],
            select: {
                id: true,
                number: true,
                status: true,
                total: true,
                currency: true,
                dateCreated: true,
                rawData: true
            }
        } satisfies Prisma.WooOrderFindManyArgs;

        try {
            const orders = await prisma.wooOrder.findMany({ ...query, where: { accountId, ...(text(status) ? { status: text(status) } : {}) } });
            if (!orders.length) return "No orders found.";

            return orders.map(o => {
                const billing = record(record(o.rawData).billing);
                return {
                id: o.number,
                status: o.status,
                total: `${o.currency} ${o.total}`,
                date: o.dateCreated?.toISOString().split('T')[0],
                customer: [text(billing.first_name), text(billing.last_name)].filter(Boolean).join(' ') || 'Guest'
                };
            });
        } catch (error) {
            Logger.error('Tool Error (getRecentOrders)', { error });
            return "Failed to retrieve orders.";
        }
    }
}
