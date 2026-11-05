import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { MAX_BOM_SYNC_TARGETS, targetKey } from './BOMSyncCheckpoint';
import { recoveryError } from './BOMSyncRecovery';

export const repairBOMSelection = {
    productId: true, variationId: true,
    product: { select: { id: true, accountId: true, wooId: true, name: true, sku: true } },
    items: { where: { isActive: true }, select: {
        id: true, childProductId: true, childVariationId: true, internalProductId: true,
        childVariation: { select: { wooId: true, productId: true } },
        supplierItemId: true, quantity: true, wasteFactor: true
    } }
} satisfies Prisma.BOMSelect;
export type RepairBOM = Prisma.BOMGetPayload<{ select: typeof repairBOMSelection }>;

export function assertRepairComponentDefinitions(bom: RepairBOM) {
    for (const item of bom.items) {
        if (item.supplierItemId && !item.childProductId && !item.childVariationId && !item.internalProductId) continue;
        const mappings = Number(Boolean(item.childProductId)) + Number(Boolean(item.internalProductId));
        const waste = Number(item.wasteFactor ?? 0);
        if (mappings !== 1 || (item.childVariationId && !item.childProductId)
            || (item.childVariationId && (!item.childVariation || item.childVariation.productId !== item.childProductId))
            || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0
            || !Number.isFinite(waste) || waste < 0) throw new Error('BOM_REPAIR_COMPONENT_INVALID');
    }
}

export function repairDefinitionFingerprint(bom: RepairBOM) {
    return createHash('sha256').update(JSON.stringify({
        productId: bom.productId, variationId: bom.variationId,
        accountId: bom.product.accountId, wooId: bom.product.wooId,
        items: bom.items.map(item => ({ ...item, quantity: Number(item.quantity), wasteFactor: Number(item.wasteFactor) }))
            .sort((a, b) => a.id.localeCompare(b.id))
    })).digest('hex');
}

/** Order actual variation targets, not product IDs: sibling BOMs may form a DAG. */
export function orderBOMRepairTargets(boms: RepairBOM[]) {
    const nodes = new Map(boms.map(bom => [targetKey(bom), bom]));
    const dependencies = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();
    for (const [id, bom] of nodes) {
        const children = new Set<string>();
        for (const item of bom.items) {
            if (!item.childProductId) continue;
            // Include a managed parent owner too if one has a BOM. Live reads
            // determine whether an inherited variation actually uses that owner.
            const parent = targetKey({ productId: item.childProductId, variationId: 0 });
            if (nodes.has(parent)) children.add(parent);
            if (item.childVariation) {
                const variation = targetKey({ productId: item.childProductId, variationId: item.childVariation.wooId });
                if (nodes.has(variation)) children.add(variation);
            }
        }
        dependencies.set(id, children);
        for (const child of children) {
            const parents = dependents.get(child) ?? new Set<string>();
            parents.add(id); dependents.set(child, parents);
        }
    }
    const ready = [...nodes.keys()].filter(id => dependencies.get(id)!.size === 0).sort();
    const ordered: RepairBOM[] = [];
    const visited = new Set<string>();
    for (let index = 0; index < ready.length; index++) {
        const id = ready[index]; visited.add(id);
        ordered.push(nodes.get(id)!);
        for (const parent of dependents.get(id) ?? []) {
            dependencies.get(parent)!.delete(id);
            if (dependencies.get(parent)!.size === 0) ready.push(parent);
        }
    }
    return { ordered, blocked: boms.filter(bom => !visited.has(targetKey(bom))), dependents };
}

export async function loadBOMRepairPlan(accountId: string) {
    const rows = await prisma.bOM.findMany({ where: { product: { accountId } }, select: repairBOMSelection, take: MAX_BOM_SYNC_TARGETS + 1 });
    if (rows.length > MAX_BOM_SYNC_TARGETS) throw recoveryError('Automatic repair exceeds the 10,000-target safety limit.', 'BOM_REPAIR_LIMIT');
    // Cost-only and intentionally deactivated BOMs are not stock repair targets.
    const boms = rows.filter(bom => bom.items.some(item => item.childProductId || item.childVariationId || item.internalProductId || !item.supplierItemId))
        .sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
    const definitions = new Map(boms.map(bom => [targetKey(bom), repairDefinitionFingerprint(bom)]));
    const fingerprint = createHash('sha256').update(JSON.stringify([...definitions])).digest('hex');
    return { boms, definitions, fingerprint, ...orderBOMRepairTargets(boms) };
}
