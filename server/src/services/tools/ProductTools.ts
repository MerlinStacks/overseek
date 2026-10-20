import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { text } from './toolData';

export class ProductTools {
    static async searchProducts(accountId: string, query: string) {
        if (!text(accountId)) return "Account ID required.";
        if (!text(query)) return "Product search query required.";
        try {
            const products = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    name: {
                        contains: text(query),
                        mode: 'insensitive'
                    }
                },
                take: 5,
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                select: {
                    name: true,
                    price: true,
                    stockStatus: true,
                    permalink: true
                }
            });

            if (!products.length) return "No products found matching that name.";
            return products;

        } catch (error) {
            Logger.error('Tool Error (searchProducts)', { error });
            return "Failed to search products.";
        }
    }
}
