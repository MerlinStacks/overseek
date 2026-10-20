import type { Prisma } from '@prisma/client';
import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import type { InventorySummary } from '../../ads/types';
import { finiteAmount, record, text } from '../toolData';

export async function processInventorySuggestions(accountId: string, suggestions: string[],
    summary: { inventory?: InventorySummary }, activeAdProductIds?: string[]): Promise<void> {
    if (!text(accountId)) return;
    try {
        const knownAds = Array.isArray(activeAdProductIds);
        const ids = knownAds ? [...new Set(activeAdProductIds.map(text).filter(Boolean))] : [];
        const numericIds = ids.filter(id => /^\d+$/.test(id) && Number.isSafeInteger(Number(id))).map(Number);
        const relevantWhere: Prisma.WooProductWhereInput = {
            accountId, stockStatus: 'outofstock',
            ...(knownAds ? { OR: [{ wooId: { in: numericIds } }, { sku: { in: ids, mode: 'insensitive' } }] } : {}),
        };
        const [total, outOfStock, relevantCount, examples] = await Promise.all([
            prisma.wooProduct.count({ where: { accountId } }),
            prisma.wooProduct.count({ where: { accountId, stockStatus: 'outofstock' } }),
            knownAds && !ids.length ? Promise.resolve(0) : prisma.wooProduct.count({ where: relevantWhere }),
            knownAds && !ids.length ? Promise.resolve([]) : prisma.wooProduct.findMany({ where: relevantWhere, take: 3,
                orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { name: true } }),
        ]);
        let lowCount = 0;
        const lowExamples: string[] = [];
        let cursor: string | undefined;
        while (true) {
            const products = await prisma.wooProduct.findMany({
                where: { accountId, stockStatus: 'instock' }, take: 500, orderBy: { id: 'asc' },
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                select: { id: true, name: true, stockQuantity: true, manageStock: true, rawData: true },
            });
            for (const product of products) {
                const quantity = finiteAmount(product.manageStock && product.stockQuantity != null
                    ? product.stockQuantity : record(product.rawData).stock_quantity);
                if (quantity != null && quantity > 0 && quantity < 5) {
                    lowCount++;
                    if (lowExamples.length < 3) lowExamples.push(product.name);
                }
            }
            if (products.length < 500) break;
            cursor = products[products.length - 1].id;
        }
        summary.inventory = { total_products: total, out_of_stock_count: outOfStock,
            relevant_out_of_stock: relevantCount, low_stock_count: lowCount, ad_match_available: knownAds };
        if (relevantCount > 0) {
            const names = examples.map(p => `"${p.name}"`).join(', ');
            const more = relevantCount > examples.length ? ` and ${relevantCount - examples.length} more` : '';
            suggestions.push(`📦 **Restock Needed**: ${relevantCount} product(s)${knownAds ? ' matched to your ad products' : ''} are out of stock: ${names}${more}. ` +
                'Review stock and campaign eligibility before advertising; automatic ad suspension has not been verified.');
        }
        if (lowCount > 0) suggestions.push(`⚠️ **Low Stock Warning**: ${lowCount} product(s) have fewer than 5 units available, including ${lowExamples.map(name => `"${name}"`).join(', ')}. Review stock before scaling ads.`);
    } catch (error) {
        Logger.warn('Failed to process inventory suggestions', { error });
    }
}
