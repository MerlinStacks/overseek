import { Prisma } from '@prisma/client';
import { resolveGuardedStockTarget, GuardedReceiptError } from './receipts';

/** Customer-order stock mutations also switch to native deltas during the cutover
 * freeze. Otherwise a legacy absolute BOM write could erase/double a PO delta.
 */
export async function guardedBomMode(tx: Prisma.TransactionClient, accountId: string) {
    const rows = await tx.$queryRaw<Array<{ guarded: boolean }>>`SELECT (a."receiptTransportMode"='GUARDED' OR COALESCE(r."receivingFrozen",false)) AS guarded
        FROM "Account" a LEFT JOIN "ReceiptAccount" r ON r."accountId"=a.id WHERE a.id=${accountId}`;
    return rows?.[0]?.guarded === true;
}

export async function queueBomStockMovement(tx: Prisma.TransactionClient, accountId: string, data: {
    ledgerId: string; orderId: number; productId: string; variationWooId: number | null; quantity: number; reversal?: boolean; originalOperationId?: string | null;
}) {
    if (!Number.isSafeInteger(data.quantity) || data.quantity <= 0 || data.quantity > 1_000_000) throw new GuardedReceiptError('Guarded BOM consumption requires a positive whole-unit quantity within the receipt bound.');
    const operationId = `bom_${data.reversal ? 'restore' : 'consume'}_${data.ledgerId}`;
    if (await tx.receiptOperation.findUnique({ where: { operationId } })) throw new GuardedReceiptError('BOM stock movement is already recorded; recover its original ledger entry.');
    let productId = data.productId; let variation = data.variationWooId;
    if (data.originalOperationId) {
        const original = await tx.receiptOperation.findFirst({ where: { accountId, operationId: data.originalOperationId } });
        if (!original) throw new GuardedReceiptError('Original BOM stock intent is missing.');
        const current = await tx.wooProduct.findFirst({ where: { accountId, wooId: original.productWooId }, select: { id: true } });
        if (!current) throw new GuardedReceiptError('Original BOM stock owner is missing.');
        productId = current.id; variation = original.stockOwnerWooId === original.productWooId ? null : original.variationWooId;
    }
    const target = await resolveGuardedStockTarget(tx, accountId, productId, variation);
    if (data.originalOperationId) {
        const original = await tx.receiptOperation.findUniqueOrThrow({ where: { operationId: data.originalOperationId } });
        if (target.stockOwnerWooId !== original.stockOwnerWooId) throw new GuardedReceiptError('Original BOM stock ownership changed; do not retarget its reversal.');
    }
    const reference = `bom-order:${data.orderId}`;
    const cycle = await tx.receiptCycle.upsert({ where: { id: `bom_cycle_${data.ledgerId}` }, create: { id: `bom_cycle_${data.ledgerId}`, accountId, purchaseOrderId: reference, active: false, skippedLines: [] }, update: {} });
    await tx.receiptAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
    const owner = await tx.receiptOwner.upsert({ where: { accountId_stockOwnerWooId: { accountId, stockOwnerWooId: target.stockOwnerWooId } },
        create: { accountId, stockOwnerWooId: target.stockOwnerWooId, lastSequence: 1 }, update: { lastSequence: { increment: 1 } } });
    const delta = data.reversal ? data.quantity : -data.quantity;
    await tx.receiptOperation.create({ data: { ...target, operationId, accountId, purchaseOrderId: reference, cycleId: cycle.id, sequence: owner.lastSequence, delta,
        sourceType: data.reversal ? 'bom_reversal' : 'bom_consumption', sourceId: data.ledgerId, cascadeState: 'waiting_receipt' } });
    const rows = target.variationId
        ? await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "ProductVariation" SET "stockQuantity"=COALESCE("stockQuantity",0)+${delta}, "stockStatus"=CASE WHEN COALESCE("stockQuantity",0)+${delta}>0 THEN 'instock' ELSE 'outofstock' END WHERE id=${target.variationId} RETURNING "stockQuantity" AS stock`
        : await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "WooProduct" SET "stockQuantity"=COALESCE("stockQuantity",0)+${delta}, "stockStatus"=CASE WHEN COALESCE("stockQuantity",0)+${delta}>0 THEN 'instock' ELSE 'outofstock' END WHERE id=${target.productId} AND "accountId"=${accountId} RETURNING "stockQuantity" AS stock`;
    if (!rows[0]) throw new GuardedReceiptError('Local BOM stock target disappeared.');
    return { operationId, stock: rows[0].stock };
}

/** Old absolute writes have no native operation journal; never convert an uncertain
 * EXECUTED legacy entry into a new delta. Materialize normal operator-review work.
 */
export async function materializeLegacyBomReviews(tx: Prisma.TransactionClient, accountId: string) {
    const entries = await tx.bOMDeductionLedger.findMany({ where: { accountId, status: 'EXECUTED', guardedOperationId: null, componentType: { not: 'InternalProduct' } }, take: 100 });
    for (const entry of entries) await ensureLegacyBomWork(tx, accountId, entry, false);
    return entries.length;
}

export async function ensureLegacyBomWork(tx: Prisma.TransactionClient, accountId: string, entry: { id: string; orderId: number; componentType: string; wooId: number | null; parentWooId: number | null }, reversal: boolean) {
    const id = `bom_legacy_${reversal ? 'restore' : 'consume'}_${entry.id}`;
    const old = await tx.receiptLegacyWork.findFirst({ where: { id, accountId } });
    if (old) return { job: old, created: false };
    await tx.receiptAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
    const targets = entry.wooId ? [{ productWooId: entry.componentType === 'ProductVariation' ? entry.parentWooId! : entry.wooId,
        variationWooId: entry.componentType === 'ProductVariation' ? entry.wooId : null }] : [];
    const job = await tx.receiptLegacyWork.create({ data: { id, accountId, purchaseOrderId: `bom-order:${entry.orderId}`, sourceType: reversal ? 'bom_reversal' : 'bom_consumption', sourceId: entry.id,
        targets: targets.length && targets[0].productWooId ? targets : Prisma.DbNull } });
    return { job, created: true };
}
