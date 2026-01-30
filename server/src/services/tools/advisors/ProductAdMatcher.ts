/**
 * Product Ad Matcher
 * 
 * Matches shopping ad products to WooCommerce inventory for margin analysis.
 * Extracted from AdOptimizer for modularity.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { ShoppingProductRef, ShoppingAnalysisData } from '../../ads/types';

/**
 * Match shopping ad products to WooCommerce inventory for margin analysis.
 * @param accountId - The account to analyze
 * @param shoppingData - Shopping campaign data with top products
 * @param suggestions - Array to push suggestions into
 */
export async function processProductAdMatch(
    accountId: string,
    shoppingData: ShoppingAnalysisData,
    suggestions: string[]
): Promise<void> {
    try {
        if (!shoppingData?.top_products?.length) return;

        // Get WooCommerce products with COGS data
        const wooProducts = await prisma.wooProduct.findMany({
            where: { accountId },
            select: {
                wooId: true,
                name: true,
                sku: true,
                price: true,
                cogs: true,
                rawData: true
            }
        });

        if (wooProducts.length === 0) return;

        // Create lookup maps
        const productsByName = new Map<string, typeof wooProducts[0]>();
        const productsBySku = new Map<string, typeof wooProducts[0]>();

        for (const p of wooProducts) {
            productsByName.set(p.name.toLowerCase().trim(), p);
            if (p.sku) productsBySku.set(p.sku.toLowerCase().trim(), p);
        }

        // Check top ad products for margin data
        for (const adProduct of shoppingData.top_products.slice(0, 5)) {
            const adTitle = (adProduct.product || '').toLowerCase().trim();
            const adId = adProduct.product_id;

            // Try to match by name or ID
            const matchedProduct = productsByName.get(adTitle) ||
                productsBySku.get(adId?.toString() || '');

            if (matchedProduct && matchedProduct.cogs && matchedProduct.price) {
                const price = parseFloat(matchedProduct.price?.toString() || '0');
                const cogs = parseFloat(matchedProduct.cogs?.toString() || '0');
                const margin = price > 0 ? ((price - cogs) / price) * 100 : 0;
                const roas = parseFloat(adProduct.roas?.replace('x', '') || '0');

                // High ROAS but low margin warning
                if (roas >= 2 && margin < 15) {
                    suggestions.push(
                        `⚠️ **Low Margin Alert**: "${adProduct.product}" has ${adProduct.roas} ROAS but only ${margin.toFixed(0)}% margin. ` +
                        `Net profit may be minimal. Consider focusing on higher-margin products.`
                    );
                }
            }
        }

        // Find top sellers NOT in ads (opportunity)
        // Only suggest in-stock products - Google Ads auto-disables out-of-stock items
        const topSellingProducts = await prisma.wooProduct.findMany({
            where: { accountId, stockStatus: { not: 'outofstock' } },
            take: 20,
            select: { name: true, rawData: true }
        });

        const adProductNames = new Set(
            (shoppingData.top_products || []).map((p) =>
                (p.product || '').toLowerCase().trim()
            )
        );

        // Find products that might be selling well but not in ads
        const potentialOpportunities = topSellingProducts.filter(p =>
            !adProductNames.has(p.name.toLowerCase().trim())
        ).slice(0, 3);

        if (potentialOpportunities.length > 0) {
            const names = potentialOpportunities.map(p => `"${p.name}"`).join(', ');
            suggestions.push(
                `🚀 **Ad Opportunity**: Products like ${names} are not in your top Shopping ads. ` +
                `Consider adding them to your campaigns.`
            );
        }

    } catch (error) {
        Logger.warn('Failed to process product-ad match', { error });
    }
}
