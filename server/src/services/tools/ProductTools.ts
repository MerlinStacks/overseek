import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class ProductTools {
    static async searchProducts(accountId: string, query: string) {
        try {
            const products = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    name: {
                        contains: query,
                        mode: 'insensitive'
                    }
                },
                take: 5,
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
