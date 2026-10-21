import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { ShoppingAnalysisData } from '../../ads/types';

/** Match explicit inventory identifiers, never infer campaign absence from a top-product sample. */
export async function processProductAdMatch(accountId: string, shoppingData: ShoppingAnalysisData, suggestions: string[]): Promise<void> {
    try {
        if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('Account required');
        if (!Array.isArray(shoppingData?.top_products) || !shoppingData.top_products.length) return;
        const products = await prisma.wooProduct.findMany({ where: { accountId }, take: 10001, orderBy: { id: 'asc' },
            select: { wooId: true, name: true, sku: true, price: true, cogs: true, variations: { select: { wooId: true, sku: true, price: true, cogs: true } } } });
        if (products.length > 10000) throw new Error('Inventory matching coverage limit exceeded');
        type Item = { wooId: number; sku: string | null; name: string; price: unknown; cogs: unknown };
        const items: Item[] = products.flatMap(product => [product, ...product.variations.map(variant => ({ ...variant, name: product.name }))]);
        const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
        const byId = new Map<string, Item[]>(); const bySku = new Map<string, Item[]>(); const byName = new Map<string, Item[]>();
        for (const item of items) for (const [map, key] of [[byId, String(item.wooId)], [bySku, normalize(item.sku)], [byName, normalize(item.name)]] as Array<[Map<string, Item[]>, string]>) {
            if (key) map.set(key, [...map.get(key) || [], item]);
        }
        let unmatched = 0;
        for (const ad of shoppingData.top_products.slice(0, 5)) {
            const id = normalize(String(ad.product_id ?? ''));
            const candidates = id ? [...byId.get(id) || [], ...bySku.get(id) || []] : byName.get(normalize(ad.product)) || [];
            const unique = [...new Map(candidates.map(item => [item.wooId, item])).values()];
            if (unique.length !== 1) { unmatched++; continue; }
            const item = unique[0];
            if (item.price == null || item.cogs == null) { unmatched++; continue; }
            const price = Number(item.price); const cost = Number(item.cogs);
            const roas = typeof ad.roas === 'string' && /^\d+(?:\.\d+)?x$/.test(ad.roas) ? Number(ad.roas.slice(0, -1)) : NaN;
            if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(roas)) { unmatched++; continue; }
            const margin = (price - cost) / price * 100;
            if (roas >= 2 && margin < 15) suggestions.push(`Low unit-margin review: "${item.name}" (inventory ID ${item.wooId}) has ${margin.toFixed(1)}% price-minus-COGS margin and ${ad.roas} reported ROAS. This is a heuristic, not net-profit evidence; review tax, shipping, other costs and attribution before acting.`);
        }
        if (unmatched) suggestions.push(`Margin analysis unavailable for ${unmatched} sampled products: inventory match was missing/ambiguous or costs/metrics were unavailable.`);
        suggestions.push('Shopping data is a capped performance sample. Products absent from this sample are not proven absent from campaigns; no sales-ranking or campaign-expansion claim was inferred.');
    } catch (error) {
        Logger.warn('Failed to process product-ad match', { error });
        suggestions.push('Product/ad margin matching unavailable; no inventory opportunity claims were inferred.');
    }
}
