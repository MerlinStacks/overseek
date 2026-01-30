import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class InventoryTools {
    static async getInventorySummary(accountId: string, limit: number = 5) {
        try {
            const lowStockProducts = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    stockStatus: 'outofstock'
                },
                take: limit || 5,
                select: {
                    name: true,
                    stockStatus: true,
                    sku: true
                },
                orderBy: { name: 'asc' }
            });

            const totalProducts = await prisma.wooProduct.count({ where: { accountId } });

            return {
                total_products: totalProducts,
                low_stock_items: lowStockProducts.length > 0 ? lowStockProducts : "None (all well stocked)"
            };

        } catch (error) {
            Logger.error('Tool Error (getInventorySummary)', { error });
            return "Failed to check inventory.";
        }
    }
}
