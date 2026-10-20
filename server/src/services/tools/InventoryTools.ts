import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class InventoryTools {
    static async getInventorySummary(accountId: string, limit: number = 5) {
        if (typeof accountId !== 'string' || !accountId.trim()) return "Account ID required.";
        const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 5;
        try {
            const lowStockProducts = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    stockStatus: 'outofstock'
                },
                take: safeLimit,
                select: {
                    name: true,
                    stockStatus: true,
                    sku: true
                },
                orderBy: [{ name: 'asc' }, { id: 'asc' }]
            });

            const totalProducts = await prisma.wooProduct.count({ where: { accountId } });

            return {
                total_products: totalProducts,
                // Preserve the existing response key, but state what this query actually measures.
                low_stock_items: lowStockProducts.length > 0 ? lowStockProducts : "None (no products marked out of stock)",
                stock_filter: 'outofstock'
            };

        } catch (error) {
            Logger.error('Tool Error (getInventorySummary)', { error });
            return "Failed to check inventory.";
        }
    }
}
