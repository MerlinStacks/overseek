import type { BOMComponentMapping } from './types';
import { BOMForecastCycleError } from './errors';

interface Product { id: string; wooId: number; isVariation?: boolean; productId?: string }
interface RecipeProduct { accountId: string; wooId: number; boms: Array<{ variationId: number }> }
export interface BOMPlanningItem {
    isActive: boolean;
    supplierItemId: string | null;
    childProductId: string | null;
    childVariationId: number | null;
    internalProductId: string | null;
    quantity: unknown;
    wasteFactor: unknown;
    childProduct: (RecipeProduct & { id: string }) | null;
    childVariation: { id: string; productId: string; wooId: number } | null;
    internalProduct: { id: string; accountId: string } | null;
    bom: { productId: string; variationId: number; product: RecipeProduct };
}
const productKey = (id: string, variation = 0) => JSON.stringify(['product', id, variation]);
const internalKey = (id: string) => JSON.stringify(['internal', id]);

/** Gross replenishment demand only. Never changes operational stock deductions. */
export function buildBOMComponentMappings(accountId: string, items: BOMPlanningItem[], productIds: string[], variationWooIds: number[], products: Product[]): BOMComponentMapping[] {
    type Parent = BOMComponentMapping['parentMappings'][number];
    const recipes = new Set(items.map(item => productKey(item.bom.productId, item.bom.variationId)));
    const targets = new Map<string, { id: string; wooId: number }>();
    const byId = new Map(products.map(product => [product.id, product]));
    const variants = new Map(products.filter(product => product.isVariation).map(product => [product.wooId, product]));
    for (const id of new Set(productIds)) {
        const product = byId.get(id);
        if (!product || product.wooId > 0) targets.set(productKey(id), { id, wooId: product?.wooId ?? 0 });
        if (!product || product.wooId === 0) targets.set(internalKey(id), { id, wooId: 0 });
    }
    for (const wooId of new Set(variationWooIds)) {
        const variant = variants.get(wooId);
        if (!variant?.productId) throw new Error('BOM component variation unresolved');
        targets.set(productKey(variant.productId, wooId), { id: variant.id, wooId });
    }
    const incoming = new Map<string, BOMPlanningItem[]>();
    for (const item of items) {
        let key: string;
        if (item.childProductId) {
            const variation = item.childVariationId || 0;
            // An explicit variant recipe replaces the default, never adds to it.
            const hasOverride = item.childProduct?.boms.some(bom => bom.variationId === variation);
            const useDefault = variation > 0 && !hasOverride && recipes.has(productKey(item.childProductId));
            key = productKey(item.childProductId, useDefault ? 0 : variation);
        } else if (item.internalProductId) key = internalKey(item.internalProductId);
        else continue; // Supplier catalogue lines have costs, not stock demand.
        if (!incoming.has(key)) incoming.set(key, []);
        incoming.get(key)!.push(item);
    }
    const parents = new Map<string, Parent>();
    const edges = new Map<string, Array<{ parent: string; factor: number }>>();
    const pending = new Map<string, number>();
    const queue = [...targets.keys()];
    const reachable = new Set(queue);
    // Validate only requested ancestry. Unrelated account recipes cannot block it.
    for (let index = 0; index < queue.length; index++) {
        const key = queue[index];
        for (const item of incoming.get(key) || []) {
            if ([item.childProductId, item.internalProductId, item.supplierItemId].filter(Boolean).length !== 1) throw new Error('BOM forecast incomplete: ambiguous component reference');
            if (!item.isActive || item.bom.product.accountId !== accountId || item.childProduct && item.childProduct.accountId !== accountId || item.internalProduct && item.internalProduct.accountId !== accountId) throw new Error('BOM forecast incomplete: inactive/foreign component');
            if (item.childProductId && (!item.childProduct || item.childProduct.id !== item.childProductId) || item.internalProductId && (!item.internalProduct || item.internalProduct.id !== item.internalProductId)) throw new Error('BOM component unresolved');
            if (item.childVariationId && (!item.childVariation || item.childVariation.productId !== item.childProductId || item.childVariation.wooId !== item.childVariationId)) throw new Error('BOM component variation unresolved');
            const target = targets.get(key);
            if (target && item.childVariationId && target.id !== item.childVariation?.id) throw new Error('BOM component variation unresolved');
            if (target && item.childProduct && !item.childVariationId) target.wooId = item.childProduct.wooId;
            const quantity = Number(item.quantity); const waste = Number(item.wasteFactor);
            if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(waste) || waste < 0 || waste > 1) throw new Error('Invalid BOM demand quantity/waste');
            const parent = productKey(item.bom.productId, item.bom.variationId);
            parents.set(parent, { parentProductId: item.bom.productId, parentWooId: item.bom.product.wooId,
                parentVariationId: item.bom.variationId, quantity: 1, wasteFactor: 0,
                excludedVariationIds: item.bom.variationId === 0 ? item.bom.product.boms.map(bom => bom.variationId).filter(id => id > 0) : [] });
            if (!edges.has(key)) edges.set(key, []);
            edges.get(key)!.push({ parent, factor: quantity * (1 + waste) });
            pending.set(parent, (pending.get(parent) || 0) + 1);
            if (!reachable.has(parent)) { reachable.add(parent); queue.push(parent); }
        }
    }
    // Kahn ordering detects cycles without recursion or enumerating paths. Sum
    // shared-path coefficients BEFORE multiplying each ancestor's direct sales.
    const ready = [...reachable].filter(key => !pending.get(key));
    const weights = new Map<string, Map<string, number>>();
    for (const [key, target] of targets) weights.set(key, new Map([[target.id, 1]]));
    let contributions = targets.size;
    for (let index = 0; index < ready.length; index++) {
        const key = ready[index];
        for (const edge of edges.get(key) || []) {
            if (!weights.has(edge.parent)) weights.set(edge.parent, new Map());
            const next = weights.get(edge.parent)!;
            for (const [target, coefficient] of weights.get(key) || []) {
                if (!next.has(target) && ++contributions > 100000) throw new Error('BOM forecast coverage limit exceeded');
                const total = (next.get(target) || 0) + coefficient * edge.factor;
                if (!Number.isFinite(total)) throw new Error('BOM demand overflow');
                next.set(target, total);
            }
            pending.set(edge.parent, pending.get(edge.parent)! - 1);
            if (!pending.get(edge.parent)) ready.push(edge.parent);
        }
    }
    if (ready.length !== reachable.size) throw new BOMForecastCycleError();
    const mappings = new Map<string, BOMComponentMapping>();
    const targetWooIds = new Map<string, number>();
    for (const target of targets.values()) {
        if (!targetWooIds.has(target.id) || target.wooId > 0) targetWooIds.set(target.id, target.wooId);
    }
    for (const [key, parent] of parents) {
        for (const [componentId, quantity] of weights.get(key) || []) {
            // Direct sales are already counted by InventoryForecastService.
            if (targets.get(key)?.id === componentId) continue;
            if (!mappings.has(componentId)) mappings.set(componentId, { componentProductId: componentId, componentWooId: targetWooIds.get(componentId) || 0, parentMappings: [] });
            mappings.get(componentId)!.parentMappings.push({ ...parent, quantity });
        }
    }
    return [...mappings.values()];
}
