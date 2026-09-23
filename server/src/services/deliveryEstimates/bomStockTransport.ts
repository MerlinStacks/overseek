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

/** Imports are observations, not acknowledgements of our queue. Bound
 * availability by the known journal projection as well as the current local
 * count. A reconciled ACK replaces the baseline (it already
 * includes that operation); only later deltas are added. Caller holds Account
 * and the resolved stock row locks throughout this calculation and the update.
 */
async function writeOffStockBaseline(tx: Prisma.TransactionClient, accountId: string, stockOwnerWooId: number) {
    const scope = { accountId, stockOwnerWooId };
    const pending = await tx.receiptOperation.findFirst({ where: { ...scope, state: { notIn: ['applied', 'reconciled'] } }, orderBy: { sequence: 'asc' } });
    const settled = await tx.receiptOperation.findFirst({ where: { ...scope, state: { in: ['applied', 'reconciled'] } }, orderBy: { sequence: 'desc' } });
    if (!pending && !settled) return null;
    let baseline = settled?.stockQuantity;
    let sequence = settled?.sequence;
    if (!settled && pending) {
        // The first write-off stores a local reservation before any ACK exists.
        // Older receipt/BOM queues have no such baseline: do not guess from an
        // imported stock value that may already include some of their deltas.
        const item = pending.sourceType === 'stock_write_off' && pending.sourceId ? await tx.stockWriteOffItem.findFirst({ where: { id: pending.sourceId, operationId: pending.operationId, writeOff: { accountId } } }) : null;
        baseline = item?.stockAfter;
        sequence = pending.sequence;
    }
    if (baseline == null || !Number.isSafeInteger(baseline) || sequence == null) throw new GuardedReceiptError('Finish outstanding stock movements and sync inventory before finalizing this write-off; the queued stock baseline is unknown.');
    const later = await tx.receiptOperation.aggregate({ where: { ...scope, sequence: { gt: sequence } }, _sum: { delta: true } });
    let stock = baseline + (later._sum.delta ?? 0);
    // Preserve a lower observation captured by a later write-off, even if a
    // subsequent Woo import raises the mirror again. Explicit reconciliation
    // after that reservation supersedes it; an ordinary (possibly replayed)
    // apply ACK must never erase the lower reservation.
    const latest = await tx.receiptOperation.findFirst({ where: { ...scope, sourceType: 'stock_write_off', sequence: { gt: sequence } }, orderBy: { sequence: 'desc' } });
    if (latest?.sourceId && !(settled?.state === 'reconciled' && settled.appliedAt && settled.appliedAt >= latest.createdAt)) {
        const item = await tx.stockWriteOffItem.findFirst({ where: { id: latest.sourceId, operationId: latest.operationId, writeOff: { accountId } } });
        if (item?.stockAfter == null) throw new GuardedReceiptError('Queued write-off stock snapshot is missing; reconcile inventory first.');
        const following = await tx.receiptOperation.aggregate({ where: { ...scope, sequence: { gt: latest.sequence } }, _sum: { delta: true } });
        stock = Math.min(stock, item.stockAfter + (following._sum.delta ?? 0));
    }
    if (!Number.isSafeInteger(stock) || stock > 2147483647) throw new GuardedReceiptError('Queued stock baseline is invalid; reconcile inventory first.');
    return stock;
}

export async function queueBomStockMovement(tx: Prisma.TransactionClient, accountId: string, data: {
    ledgerId: string; orderId: number; productId: string; variationWooId: number | null; quantity: number; reversal?: boolean; originalOperationId?: string | null;
    writeOffId?: string;
}) {
    if (!Number.isSafeInteger(data.quantity) || data.quantity <= 0 || data.quantity > 1_000_000) throw new GuardedReceiptError('Guarded BOM consumption requires a positive whole-unit quantity within the receipt bound.');
    if (data.writeOffId && data.reversal) throw new GuardedReceiptError('Write-offs cannot be reversed by the BOM transport.');
    const operationId = data.writeOffId ? `writeoff_${data.ledgerId}` : `bom_${data.reversal ? 'restore' : 'consume'}_${data.ledgerId}`;
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
    const baseline = data.writeOffId ? await writeOffStockBaseline(tx, accountId, target.stockOwnerWooId) : null;
    if (baseline !== null && baseline < data.quantity) throw new GuardedReceiptError('Stock is insufficient after outstanding stock movements. Reduce the write-off quantity or reconcile inventory.');
    if (data.originalOperationId) {
        const original = await tx.receiptOperation.findUniqueOrThrow({ where: { operationId: data.originalOperationId } });
        if (target.stockOwnerWooId !== original.stockOwnerWooId) throw new GuardedReceiptError('Original BOM stock ownership changed; do not retarget its reversal.');
    }
    const reference = data.writeOffId ? `writeoff:${data.writeOffId}` : `bom-order:${data.orderId}`;
    const cycle = await tx.receiptCycle.upsert({ where: { id: `bom_cycle_${data.ledgerId}` }, create: { id: `bom_cycle_${data.ledgerId}`, accountId, purchaseOrderId: reference, active: false, skippedLines: [] }, update: {} });
    await tx.receiptAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
    const owner = await tx.receiptOwner.upsert({ where: { accountId_stockOwnerWooId: { accountId, stockOwnerWooId: target.stockOwnerWooId } },
        create: { accountId, stockOwnerWooId: target.stockOwnerWooId, lastSequence: 1 }, update: { lastSequence: { increment: 1 } } });
    const delta = data.reversal ? data.quantity : -data.quantity;
    if (owner.lastSequence > BigInt(Number.MAX_SAFE_INTEGER)) throw new GuardedReceiptError('Stock owner sequence exhausted.');
    await tx.receiptOperation.create({ data: { ...target, operationId, accountId, purchaseOrderId: reference, cycleId: cycle.id, sequence: owner.lastSequence, delta,
        sourceType: data.writeOffId ? 'stock_write_off' : data.reversal ? 'bom_reversal' : 'bom_consumption', sourceId: data.ledgerId, cascadeState: 'waiting_receipt' } });
    const rows = data.writeOffId ? (target.variationId
        ? await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "ProductVariation" SET "stockQuantity"=LEAST("stockQuantity",${baseline}::integer)+${delta}, "stockStatus"=CASE WHEN LEAST("stockQuantity",${baseline}::integer)+${delta}>0 THEN 'instock' ELSE 'outofstock' END WHERE id=${target.variationId} AND "productId"=${target.productId} AND "stockQuantity">=${data.quantity} RETURNING "stockQuantity" AS stock`
        : await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "WooProduct" SET "stockQuantity"=LEAST("stockQuantity",${baseline}::integer)+${delta}, "stockStatus"=CASE WHEN LEAST("stockQuantity",${baseline}::integer)+${delta}>0 THEN 'instock' ELSE 'outofstock' END WHERE id=${target.productId} AND "accountId"=${accountId} AND "stockQuantity">=${data.quantity} RETURNING "stockQuantity" AS stock`)
        : target.variationId
        ? await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "ProductVariation" SET "stockQuantity"=COALESCE("stockQuantity",0)+${delta}, "stockStatus"=CASE WHEN COALESCE("stockQuantity",0)+${delta}>0 THEN 'instock' ELSE 'outofstock' END WHERE id=${target.variationId} RETURNING "stockQuantity" AS stock`
        : await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "WooProduct" SET "stockQuantity"=COALESCE("stockQuantity",0)+${delta}, "stockStatus"=CASE WHEN COALESCE("stockQuantity",0)+${delta}>0 THEN 'instock' ELSE 'outofstock' END WHERE id=${target.productId} AND "accountId"=${accountId} RETURNING "stockQuantity" AS stock`;
    if (!rows[0]) throw new GuardedReceiptError('Stock is insufficient, unknown, or the stock target disappeared. Sync inventory and reduce the write-off quantity.');
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
