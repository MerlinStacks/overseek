/**
 * Inventory Advisor
 * 
 * Generates stock-related suggestions for ad optimization.
 * Extracted from AdOptimizer for modularity.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { InventorySummary } from '../../ads/types';

/**
 * Process inventory data to generate stock-related suggestions.
 * @param accountId - The account to analyze
 * @param suggestions - Array to push suggestions into
 * @param summary - Object to populate with inventory summary
 * @param activeAdProductIds - Optional list of product IDs currently in ads (skus or IDs)
 */
export async function processInventorySuggestions(
    accountId: string,
    suggestions: string[],
    summary: { inventory?: InventorySummary },
    activeAdProductIds?: string[]
): Promise<void> {
    try {
        const outOfStockProducts = await prisma.wooProduct.findMany({
            where: { accountId, stockStatus: 'outofstock' },
            take: 10,
            select: { name: true, sku: true, wooId: true }
        });

        const lowStockProducts = await prisma.wooProduct.findMany({
            where: { accountId, stockStatus: 'instock' },
            take: 100,
            select: { name: true, sku: true, rawData: true }
        });

        const trulyLowStock = lowStockProducts.filter((p: { rawData: unknown }) => {
            const stockQty = (p.rawData as { stock_quantity?: number })?.stock_quantity;
            return typeof stockQty === 'number' && stockQty > 0 && stockQty < 5;
        }).slice(0, 5);

        const totalProducts = await prisma.wooProduct.count({ where: { accountId } });

        // Filter out of stock alerts to ONLY those being advertised
        // If we have ad data, we shouldn't warn about products not in ads
        let relevantOutOfStock = outOfStockProducts;

        if (activeAdProductIds && activeAdProductIds.length > 0) {
            const activeIdsSet = new Set(activeAdProductIds.map(id => id.toLowerCase().trim()));

            relevantOutOfStock = outOfStockProducts.filter((p) => {
                const sku = (p.sku || '').toLowerCase().trim();
                const wooId = (p.wooId || '').toString();

                // Match against SKU or ID (Google Merchant Center usually uses one of these)
                return activeIdsSet.has(sku) || activeIdsSet.has(wooId);
            });
        }

        const outOfStockCount = relevantOutOfStock.length;

        summary.inventory = {
            total_products: totalProducts,
            out_of_stock_count: outOfStockProducts.length, // Keep real count in summary
            relevant_out_of_stock: outOfStockCount,
            low_stock_count: trulyLowStock.length
        };

        if (outOfStockCount > 0) {
            const productNames = relevantOutOfStock.slice(0, 3).map((p) => `"${p.name}"`).join(', ');
            const moreText = outOfStockCount > 3 ? ` and ${outOfStockCount - 3} more` : '';
            suggestions.push(
                `📦 **Restock Needed**: ${outOfStockCount} product(s) in your ad campaigns are out of stock: ${productNames}${moreText}. ` +
                `Google Ads has auto-disabled these items. Restock to resume advertising and capture demand.`
            );
        }

        if (trulyLowStock.length > 0) {
            const productNames = trulyLowStock.slice(0, 3).map((p) => `"${p.name}"`).join(', ');
            suggestions.push(
                `⚠️ **Low Stock Warning**: ${trulyLowStock.length} product(s) have low inventory: ${productNames}. ` +
                `Avoid scaling ads for these until restocked.`
            );
        }

    } catch (error) {
        Logger.warn('Failed to process inventory suggestions', { error });
    }
}
