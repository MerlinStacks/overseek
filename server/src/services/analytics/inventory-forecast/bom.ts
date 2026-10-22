import { prisma } from '../../../utils/prisma';
import { getHistoricalSales } from './sales';
import type { BOMComponentMapping } from './types';

export async function getBOMComponentMappings(accountId: string, productIds: string[], variationWooIds: number[],
    products: Array<{ id: string; wooId: number; isVariation?: boolean; productId?: string }>): Promise<BOMComponentMapping[]> {
    if (typeof accountId !== 'string' || !accountId.trim() || !Array.isArray(productIds) || productIds.length > 10000 || productIds.some(id => typeof id !== 'string' || !id || id.length > 128) || !Array.isArray(variationWooIds) || variationWooIds.length > 5000 || variationWooIds.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647) || !Array.isArray(products) || products.length > 15000) throw new Error('Invalid BOM forecast scope/coverage');
    if (!productIds.length && !variationWooIds.length) return [];
    const items = await prisma.bOMItem.findMany({ where: { bom: { product: { accountId } }, OR: [
        { childProductId: { in: productIds } }, { internalProductId: { in: productIds } }, { childVariationId: { in: variationWooIds } },
    ] }, take: 10001, select: { isActive: true, supplierItemId: true, childProductId: true, childVariationId: true, internalProductId: true, quantity: true, wasteFactor: true,
        childProduct: { select: { id: true, accountId: true, wooId: true } }, childVariation: { select: { id: true, productId: true, wooId: true } }, internalProduct: { select: { id: true, accountId: true } },
        bom: { select: { productId: true, variationId: true, product: { select: { accountId: true, wooId: true, boms: { select: { variationId: true } } } } } } } });
    if (items.length > 10000) throw new Error('BOM forecast coverage limit exceeded');
    const parentIds = [...new Set(items.map(item => item.bom.productId))];
    // A one-level forecast cannot truthfully resolve a component of another bundle.
    if (parentIds.length && await prisma.bOMItem.findFirst({ where: { isActive: true, childProductId: { in: parentIds }, bom: { product: { accountId } } }, select: { id: true } })) throw new Error('BOM forecast unavailable: nested/cyclic component demand requires multi-level planning');
    const mappings = new Map<string, BOMComponentMapping>();
    for (const item of items) {
        if (item.childVariationId && !variationWooIds.includes(item.childVariationId)) continue; // Never substitute parent stock for an unrequested variation.
        if ([item.childProductId, item.internalProductId, item.supplierItemId].filter(Boolean).length !== 1) throw new Error('BOM forecast incomplete: ambiguous component reference');
        if (item.isActive === false || item.bom.product.accountId !== accountId || item.childProduct && item.childProduct.accountId !== accountId || item.internalProduct && item.internalProduct.accountId !== accountId) throw new Error('BOM forecast incomplete: inactive/foreign component');
        let componentId: string; let componentWooId = 0;
        if (item.childVariationId) {
            const variant = products.find(product => product.isVariation && product.wooId === item.childVariationId && product.id === item.childVariation?.id);
            if (!variant || item.childVariation.productId !== item.childProductId) throw new Error('BOM component variation unresolved');
            componentId = variant.id; componentWooId = variant.wooId;
        } else if (item.childProduct) { componentId = item.childProduct.id; componentWooId = item.childProduct.wooId; }
        else if (item.internalProduct) componentId = item.internalProduct.id;
        else throw new Error('BOM component unresolved');
        const quantity = Number(item.quantity); const wasteFactor = Number(item.wasteFactor);
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(wasteFactor) || wasteFactor < 0 || wasteFactor > 1) throw new Error('Invalid BOM demand quantity/waste');
        if (!mappings.has(componentId)) mappings.set(componentId, { componentProductId: componentId, componentWooId, parentMappings: [] });
        mappings.get(componentId)!.parentMappings.push({ parentProductId: item.bom.productId, parentWooId: item.bom.product.wooId, parentVariationId: item.bom.variationId,
            quantity, wasteFactor, excludedVariationIds: item.bom.variationId === 0 ? item.bom.product.boms.map(bom => bom.variationId).filter(id => id > 0) : [] });
    }
    return [...mappings.values()];
}

export async function calculateBOMDerivedDemand(accountId: string, mappings: BOMComponentMapping[], days: number): Promise<Map<string, number>> {
    if (!accountId || !Number.isInteger(days) || days < 1 || days > 730 || mappings.length > 10000) throw new Error('Invalid BOM demand window/scope');
    const result = new Map<string, number>();
    if (!mappings.length) return result;
    const products = new Set<number>(); const variants = new Set<number>(); const excluded: Record<number, number[]> = {};
    for (const mapping of mappings) for (const parent of mapping.parentMappings) {
        if (parent.parentVariationId > 0) variants.add(parent.parentVariationId);
        else { products.add(parent.parentWooId); excluded[parent.parentWooId] = parent.excludedVariationIds || []; }
        if (!Number.isFinite(parent.quantity) || parent.quantity <= 0 || !Number.isFinite(parent.wasteFactor) || parent.wasteFactor < 0 || parent.wasteFactor > 1) throw new Error('Invalid BOM mapping quantities');
    }
    const sales = await getHistoricalSales(accountId, [...products], [...variants], days, excluded);
    for (const mapping of mappings) {
        let demand = 0;
        for (const parent of mapping.parentMappings) demand += (sales.get(parent.parentVariationId || parent.parentWooId) || []).reduce((sum, sale) => sum + sale.quantity, 0) / days * parent.quantity * (1 + parent.wasteFactor);
        if (!Number.isFinite(demand)) throw new Error('BOM demand overflow');
        result.set(mapping.componentProductId, demand);
    }
    return result;
}
