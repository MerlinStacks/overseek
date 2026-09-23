import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { dirtyInboundProducts } from './intents';

export class GuardedReceiptError extends Error {}
const fail = (message: string): never => { throw new GuardedReceiptError(`Guarded receipt: ${message}`); };
const positiveId = (id: number) => Number.isSafeInteger(id) && id > 0;

/** Caller holds Account. Only an explicitly persisted mode selects this path. */
export async function guardedReceiptMode(tx: Prisma.TransactionClient, accountId: string) {
    const control = await tx.receiptAccount.findUnique({ where: { accountId } });
    if (control?.receivingFrozen) return fail('receiving is frozen during cutover; complete or recover the cutover first');
    const rows = await tx.$queryRaw<Array<{ receiptTransportMode: string }>>`
        SELECT "receiptTransportMode" FROM "Account" WHERE "id" = ${accountId}`;
    return rows[0]?.receiptTransportMode === 'GUARDED';
}

/** Generic PO edits cannot manufacture/drop receipt state; dedicated methods own it. */
export async function guardReceiptStatusEdit(tx: Prisma.TransactionClient, accountId: string, status: string | undefined, poId?: string) {
    if (status === undefined || !await guardedReceiptMode(tx, accountId)) return;
    const existing = poId ? await tx.purchaseOrder.findFirst({ where: { id: poId, accountId }, select: { status: true } }) : null;
    if (status !== existing?.status && (status === 'RECEIVED' || existing?.status === 'RECEIVED')) fail('use receive/unreceive to transition receipt status');
}

type Target = { productId: string; variationId: string | null; productWooId: number; variationWooId: number | null; stockOwnerWooId: number; delta: number };
export { resolveTarget as resolveGuardedStockTarget };

async function resolveTarget(tx: Prisma.TransactionClient, accountId: string, productId: string | null, variationWooId: number | null): Promise<Omit<Target, 'delta'>> {
    if (!productId) return fail('unlinked or supplier-only lines are unsupported');
    await tx.$queryRaw`SELECT "id" FROM "WooProduct" WHERE "id" = ${productId} AND "accountId" = ${accountId} FOR UPDATE`;
    const product = await tx.wooProduct.findFirst({ where: { id: productId, accountId }, include: {
        boms: { select: { id: true } },
    } });
    if (!product || !positiveId(product.wooId)) return fail('product identity unavailable');
    const raw = product.rawData as Record<string, unknown>;
    if (raw?.id !== product.wooId) return fail('unverified product identity');
    if (variationWooId === null) {
        if (!['simple', 'variable'].includes(String(raw.type)) || raw.manage_stock !== true || !product.manageStock) return fail('only directly stock-managed simple/variable owners are supported');
        return { productId, variationId: null, productWooId: product.wooId, variationWooId: null, stockOwnerWooId: product.wooId };
    }
    if (!positiveId(variationWooId) || variationWooId === product.wooId || raw.type !== 'variable') return fail('invalid variation parent');
    await tx.$queryRaw`SELECT "id" FROM "ProductVariation" WHERE "productId" = ${productId} AND "wooId" = ${variationWooId} FOR UPDATE`;
    const variation = await tx.productVariation.findUnique({ where: { productId_wooId: { productId, wooId: variationWooId } } });
    const vr = variation?.rawData as Record<string, unknown> | null;
    const inherited = !!vr && (vr.manage_stock === 'parent' || vr.manage_stock === false) && raw.manage_stock === true && product.manageStock;
    if (!variation || (!inherited && (!variation.manageStock || vr?.manage_stock !== true)) || vr?.id !== variationWooId ||
        (vr.parent_id !== undefined ? vr.parent_id !== product.wooId : !Array.isArray(raw.variations) || !raw.variations.includes(variationWooId))) {
        return fail('variation identity or independent stock ownership unverified');
    }
    return { productId, variationId: inherited ? null : variation.id, productWooId: product.wooId, variationWooId, stockOwnerWooId: inherited ? product.wooId : variationWooId };
}

/** Account + PO locks already held. All validation precedes any local stock mutation.
 * No remote/Redis dependency, including on commit. Reversals use the immutable ledger.
 */
export async function recordGuardedReceipt(tx: Prisma.TransactionClient, accountId: string, po: {
    id: string; status: string; items: Array<{ id?: string; name?: string; productId: string | null; variationWooId: number | null; quantity: number }>;
}, reversal: boolean) {
    const active = await tx.receiptCycle.findFirst({ where: { accountId, purchaseOrderId: po.id, active: true }, include: { operations: { where: { delta: { gt: 0 } } } } });
    if ((!reversal && active) || (reversal && !active && po.status !== 'RECEIVED')) {
        return { guarded: true as const, skipped: true as const, updated: 0, errors: ['Receipt already processed'], updatedProductIds: [], syncTargets: [] };
    }
    if (reversal && !active) return fail('no guarded receipt ledger exists; legacy receipt requires reconciliation');
    if (!reversal && po.status === 'RECEIVED') return fail('received PO has no guarded provenance');
    const targets = new Map<number, Target>();
    const errors: string[] = [];
    const skippedLines: Prisma.InputJsonObject[] = [];
    if (reversal) {
        for (const op of active!.operations) {
            if (!['applied', 'reconciled'].includes(op.state)) return fail('finish receipt application/reconciliation before reversing this cycle');
            const current = await tx.wooProduct.findFirst({ where: { accountId, wooId: op.productWooId }, select: { id: true } });
            if (!current) return fail('original received target changed or is missing; review inventory before reversal');
            // A parent-owned receipt targets the physical parent, not the representative
            // sibling that happened to be first in the original PO's aggregated lines.
            const target = await resolveTarget(tx, accountId, current.id, op.stockOwnerWooId === op.productWooId ? null : op.variationWooId);
            if (target.productWooId !== op.productWooId || target.stockOwnerWooId !== op.stockOwnerWooId) return fail('original received target changed');
            targets.set(op.stockOwnerWooId, { ...target, delta: -op.delta });
        }
    } else {
        for (const item of po.items) {
            const skip = (reason: string, warning?: string) => {
                skippedLines.push({ lineId: item.id ?? null, productId: item.productId, variationWooId: item.variationWooId, quantity: item.quantity, reason });
                if (warning) errors.push(warning);
            };
            if (!item.productId) { skip('unlinked_or_supplier_only'); continue; }
            await tx.$queryRaw`SELECT "id" FROM "WooProduct" WHERE "id" = ${item.productId} AND "accountId" = ${accountId} FOR UPDATE`;
            const product = await tx.wooProduct.findFirst({ where: { id: item.productId, accountId }, include: { boms: { select: { items: {
                where: { OR: [{ childProductId: { not: null } }, { internalProductId: { not: null } }] }, select: { id: true }, take: 1,
            } } } } });
            if (!product) { skip('missing_linked_product'); continue; }
            if (product.boms.some(bom => bom.items.length > 0)) { skip('finished_bom', `${product.name} is a BOM product - stock not updated`); continue; }
            const raw = product.rawData as Record<string, unknown> | null;
            if (item.variationWooId === null && raw?.type === 'variable' && (raw.manage_stock !== true || !product.manageStock)) {
                skip('variable_parent_requires_variation', `${product.name}: Cannot set stock on variable parent — specify a variation`); continue;
            }
            if (item.variationWooId !== null && !await tx.productVariation.findUnique({ where: { productId_wooId: { productId: item.productId, wooId: item.variationWooId } } })) {
                skip('missing_variation', `${item.name ?? product.name}: Variation ${item.variationWooId} not found locally — sync products first`); continue;
            }
            if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) return fail('quantity must be a positive safe integer');
            const target = await resolveTarget(tx, accountId, item.productId, item.variationWooId);
            const previous = targets.get(target.stockOwnerWooId);
            if (previous && (previous.productId !== target.productId || previous.variationId !== target.variationId)) return fail('conflicting stock owner mappings');
            const delta = (previous?.delta ?? 0) + item.quantity;
            if (!Number.isSafeInteger(delta) || delta > 1_000_000) return fail('aggregated receipt exceeds delta bound');
            targets.set(target.stockOwnerWooId, { ...(previous ?? target), delta });
        }
    }
    // Empty cycles are real provenance: reversing one must not inspect edited PO lines
    // and invent stock operations for items that were skipped on receipt.
    const cycle = active ?? await tx.receiptCycle.create({ data: { accountId, purchaseOrderId: po.id, skippedLines } });
    await tx.receiptAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
    for (const target of [...targets.values()].sort((a, b) => a.stockOwnerWooId - b.stockOwnerWooId)) {
        const owner = await tx.receiptOwner.upsert({ where: { accountId_stockOwnerWooId: { accountId, stockOwnerWooId: target.stockOwnerWooId } },
            create: { accountId, stockOwnerWooId: target.stockOwnerWooId, lastSequence: 1 }, update: { lastSequence: { increment: 1 } } });
        if (owner.lastSequence > BigInt(Number.MAX_SAFE_INTEGER)) return fail('owner sequence exhausted');
        const operation = await tx.receiptOperation.create({ data: { ...target, operationId: randomUUID(), accountId, purchaseOrderId: po.id, cycleId: cycle.id, sequence: owner.lastSequence, cascadeState: 'waiting_receipt' } });
        const rows = target.variationId
            ? await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "ProductVariation" SET "stockQuantity" = COALESCE("stockQuantity", 0) + ${target.delta},
                "stockStatus" = CASE WHEN COALESCE("stockQuantity", 0) + ${target.delta} > 0 THEN 'instock' ELSE 'outofstock' END
                WHERE "id" = ${target.variationId} AND "productId" = ${target.productId} RETURNING "stockQuantity" AS stock`
            : await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "WooProduct" SET "stockQuantity" = COALESCE("stockQuantity", 0) + ${target.delta},
                "stockStatus" = CASE WHEN COALESCE("stockQuantity", 0) + ${target.delta} > 0 THEN 'instock' ELSE 'outofstock' END
                WHERE "id" = ${target.productId} AND "accountId" = ${accountId} RETURNING "stockQuantity" AS stock`;
        if (!rows[0]) return fail('local stock target disappeared');
        await tx.auditLog.create({ data: { accountId, action: 'UPDATE', resource: 'PRODUCT', resourceId: target.productId, source: 'SYSTEM_SYNC', validationStatus: 'PASSED',
            previousValue: { stock_quantity: rows[0].stock - target.delta }, details: { stock_quantity: rows[0].stock, movementType: reversal ? 'PO_REVERSAL' : 'PO_RECEIPT', reference: po.id, operationId: operation.operationId, variationWooId: target.variationWooId } } });
    }
    if (reversal) await tx.receiptCycle.update({ where: { id: cycle.id }, data: { active: false } });
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: reversal ? 'ORDERED' : 'RECEIVED' } });
    await dirtyInboundProducts(tx, accountId, [...targets.values()].map(t => t.productWooId));
    return { guarded: true as const, skipped: false as const, updated: targets.size, errors, updatedProductIds: [...new Set([...targets.values()].map(t => t.productId))], syncTargets: [] };
}
