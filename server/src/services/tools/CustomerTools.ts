import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class CustomerTools {
    static async findCustomer(accountId: string, query: string) {
        if (typeof accountId !== 'string' || !accountId.trim()) return "Account ID required.";
        if (typeof query !== 'string' || !query.trim()) return "Customer search query required.";
        const search = query.trim();
        try {
            const customers = await prisma.wooCustomer.findMany({
                where: {
                    accountId,
                    OR: [
                        { email: { contains: search, mode: 'insensitive' } },
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } }
                    ]
                },
                take: 3,
                orderBy: [{ email: 'asc' }, { id: 'asc' }],
                select: {
                    firstName: true,
                    lastName: true,
                    email: true,
                    totalSpent: true,
                    ordersCount: true
                }
            });

            if (!customers.length) return "No customer found.";
            return customers;

        } catch (error) {
            Logger.error('Tool Error (findCustomer)', { error });
            return "Failed to find customer.";
        }
    }
}
