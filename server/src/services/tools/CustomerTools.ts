import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class CustomerTools {
    static async findCustomer(accountId: string, query: string) {
        try {
            const customers = await prisma.wooCustomer.findMany({
                where: {
                    accountId,
                    OR: [
                        { email: { contains: query, mode: 'insensitive' } },
                        { firstName: { contains: query, mode: 'insensitive' } },
                        { lastName: { contains: query, mode: 'insensitive' } }
                    ]
                },
                take: 3,
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
