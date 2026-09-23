import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { lockDeliveryAccount } from './deliveryEstimates/intents';
import { guardedReceiptMode, GuardedReceiptError, resolveGuardedStockTarget } from './deliveryEstimates/receipts';
import { queueBomStockMovement } from './deliveryEstimates/bomStockTransport';
import { activeProductWhere } from './productStatus';

const reasons = z.enum(['MISSING', 'DAMAGED', 'ENTRY_ERROR', 'EXPIRED', 'OTHER']);
const lineSchema = z.object({
    productId: z.string().min(1).max(100).optional(), variationId: z.number().int().positive().max(2147483647).optional(),
    internalProductId: z.string().min(1).max(100).optional(), quantity: z.number().int().min(1).max(1_000_000),
    unitCostOverride: z.number().finite().min(0).max(999_999_999).optional(),
}).strict().refine(v => !!v.productId !== !!v.internalProductId && (!v.variationId || !!v.productId), 'Choose exactly one Woo product/variation or internal product');
export const writeOffBodySchema = z.object({ reason: reasons, notes: z.string().trim().max(5000).optional(), items: z.array(lineSchema).min(1).max(100) }).strict()
    .refine(v => new Set(v.items.map(i => `${i.productId ?? i.internalProductId}:${i.variationId ?? 0}`)).size === v.items.length, 'Duplicate items are not allowed');
export const writeOffQuerySchema = z.object({
    status: z.enum(['DRAFT', 'FINALIZED']).optional(), reason: reasons.optional(), from: z.iso.date().optional(), to: z.iso.date().optional(),
    asOf: z.iso.datetime().optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
}).strict().refine(v => !v.from || !v.to || v.from <= v.to, 'from must be on or before to');
type Line = z.infer<typeof lineSchema>;
type Body = z.infer<typeof writeOffBodySchema>;
type Query = z.infer<typeof writeOffQuerySchema>;
const fail = (message: string, statusCode = 409): never => { throw Object.assign(new Error(message), { statusCode }); };

/** An override is the complete per-unit valuation, including miscellaneous costs. */
export function writeOffUnitCost(cogs: Prisma.Decimal | null, miscCosts: unknown, override?: number | Prisma.Decimal | null) {
    if (override != null) return new Prisma.Decimal(override).toDecimalPlaces(4);
    if (cogs == null) return null;
    let total = new Prisma.Decimal(cogs);
    if (!total.isFinite() || total.isNegative()) return fail('Invalid COGS; fix the product cost or provide a unit cost override.');
    if (miscCosts != null && !Array.isArray(miscCosts)) return fail('Invalid miscellaneous costs; fix the product costs or provide a unit cost override.');
    for (const cost of (miscCosts ?? []) as Array<{ amount?: unknown }>) {
        const amount = cost?.amount;
        if ((typeof amount !== 'number' && typeof amount !== 'string') || amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0)
            return fail('Invalid miscellaneous costs; fix the product costs or provide a unit cost override.');
        total = total.plus(new Prisma.Decimal(amount));
    }
    if (!total.isFinite() || total.isNegative() || total.greaterThan(999_999_999)) return fail('Unit cost is outside the supported range.');
    return total.toDecimalPlaces(4);
}

async function target(tx: Prisma.TransactionClient, accountId: string, item: Line) {
    if (item.internalProductId) {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "InternalProduct" WHERE id=${item.internalProductId} AND "accountId"=${accountId} FOR UPDATE`;
        if (!locked.length) return fail('Internal product not found in this account.', 404);
        const p = await tx.internalProduct.findFirst({ where: { id: item.internalProductId, accountId } });
        if (!p) return fail('Internal product not found in this account.', 404);
        if (!Number.isSafeInteger(p.stockQuantity) || p.stockQuantity < 0) return fail('Internal stock is unknown or invalid. Verify component inventory first.');
        return { name: p.name, sku: p.sku, stockQuantity: p.stockQuantity, cogs: p.cogs, miscCosts: p.miscCosts, type: 'INTERNAL' };
    }
    const owner = await resolveGuardedStockTarget(tx, accountId, item.productId!, item.variationId ?? null);
    const p = await tx.wooProduct.findFirstOrThrow({ where: { id: item.productId, accountId }, include: { boms: { include: { items: true } } } });
    // Conservatively exclude the whole family when any finished variant is derived.
    if (p.boms.some(b => b.items.some(i => i.childProductId || i.internalProductId))) return fail('BOM-derived finished products cannot be written off. Write off their components instead.');
    const v = item.variationId ? await tx.productVariation.findUniqueOrThrow({ where: { productId_wooId: { productId: p.id, wooId: item.variationId } } }) : null;
    const stockQuantity = owner.variationId ? v!.stockQuantity : p.stockQuantity;
    if (stockQuantity == null || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0) return fail('Stock is unknown or invalid. Sync and verify local stock first.');
    return { name: v ? `${p.name} — ${v.sku || `#${v.wooId}`}` : p.name, sku: v ? v.sku : p.sku,
        stockQuantity,
        // Match the inventory/order valuation convention: absent/zero variant COGS
        // falls back to the parent, retaining variant extras when supplied.
        cogs: v && v.cogs != null && !v.cogs.isZero() ? v.cogs : p.cogs ?? v?.cogs ?? null,
        miscCosts: v && v.cogs != null && !v.cogs.isZero() ? v.miscCosts
            : v?.miscCosts != null && (!Array.isArray(v.miscCosts) || v.miscCosts.length > 0) ? v.miscCosts : p.miscCosts,
        type: v ? 'VARIATION' : 'PRODUCT', owner };
}

async function snapshots(tx: Prisma.TransactionClient, accountId: string, items: Line[]) {
    const rows = [];
    for (const item of items) {
        const p = await target(tx, accountId, item);
        const unitCost = writeOffUnitCost(p.cogs, p.miscCosts, item.unitCostOverride);
        if (unitCost === null) return fail(`${p.name}: missing COGS. Enter an explicit unitCostOverride on the draft item (zero is allowed).`, 400);
        rows.push({ ...item, name: p.name, sku: p.sku, type: p.type, unitCost, totalCost: unitCost.mul(item.quantity) });
    }
    return rows;
}

const includeItems = { items: { orderBy: { id: 'asc' as const } } };
export async function getWriteOff(accountId: string, id: string, db: Prisma.TransactionClient = prisma) {
    const doc = await db.stockWriteOff.findFirst({ where: { id, accountId }, include: includeItems });
    if (!doc) return fail('Write-off not found.', 404);
    const ops = await db.receiptOperation.findMany({ where: { accountId, operationId: { in: doc.items.flatMap(i => i.operationId ? [i.operationId] : []) } }, select: { operationId: true, state: true, cascadeState: true, lastError: true, cascadeError: true, owner: { select: { parked: true } } } });
    const control = ops.length ? await db.receiptAccount.findUnique({ where: { accountId }, select: { capability: true } }) : null;
    const blocked = ops.some(o => ['parked', 'uncertain', 'reconciliation_failed'].includes(o.state) || o.cascadeState === 'failed' || (!['applied', 'reconciled'].includes(o.state) && (o.owner?.parked || control?.capability === 'blocked'))) || doc.items.some(i => i.cascadeState === 'failed' || (i.cascadeState === 'pending' && !!i.cascadeError));
    const pending = ops.some(o => !['applied', 'reconciled'].includes(o.state) || o.cascadeState !== 'done') || doc.items.some(i => i.cascadeState === 'pending');
    return { ...doc, totalCost: Number(doc.totalCost), items: doc.items.map(i => ({ ...i, unitCost: Number(i.unitCost), unitCostOverride: i.unitCostOverride == null ? null : Number(i.unitCostOverride), totalCost: Number(i.totalCost) })),
        syncStatus: doc.status === 'DRAFT' ? 'NOT_REQUIRED' : blocked ? 'NEEDS_ATTENTION' : pending ? 'PENDING' : 'SYNCED', syncOperations: ops };
}

export async function saveWriteOff(accountId: string, actorId: string, body: Body, id?: string) {
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const previous = id ? await getWriteOff(accountId, id, tx) : null;
        if (previous && previous.status !== 'DRAFT') return fail('Only drafts can be edited.');
        const items = await snapshots(tx, accountId, body.items);
        const data = { reason: body.reason, notes: body.notes ?? null, totalCost: items.reduce((n, i) => n.plus(i.totalCost), new Prisma.Decimal(0)) };
        const doc = id ? await tx.stockWriteOff.update({ where: { id }, data: { ...data, items: { deleteMany: {}, create: items } } })
            : await tx.stockWriteOff.create({ data: { ...data, accountId, createdBy: actorId, reference: `WO-${randomUUID()}`, items: { create: items } } });
        await tx.auditLog.create({ data: { accountId, userId: actorId, action: id ? 'UPDATE' : 'CREATE', resource: 'STOCK_WRITE_OFF', resourceId: doc.id,
            previousValue: previous ? JSON.parse(JSON.stringify(previous)) : Prisma.DbNull, details: { reason: body.reason, draft: JSON.parse(JSON.stringify(body)) } } });
        return getWriteOff(accountId, doc.id, tx);
    }, { timeout: 30_000 });
}

export async function deleteWriteOff(accountId: string, actorId: string, id: string) {
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const doc = await getWriteOff(accountId, id, tx);
        if (doc.status !== 'DRAFT') return fail('Only drafts can be deleted.');
        await tx.auditLog.create({ data: { accountId, userId: actorId, action: 'DELETE', resource: 'STOCK_WRITE_OFF', resourceId: id, previousValue: JSON.parse(JSON.stringify(doc)), details: { reason: doc.reason } } });
        await tx.stockWriteOff.delete({ where: { id } });
        return { deleted: true };
    });
}

export async function finalizeWriteOff(accountId: string, actorId: string, id: string) {
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const doc = await getWriteOff(accountId, id, tx);
        if (doc.status === 'FINALIZED') return doc;
        // Freeze is respected even for internal components (their derived stock reaches Woo).
        const guarded = await guardedReceiptMode(tx, accountId);
        const hasCascade = await tx.bOMItem.count({ where: { internalProductId: { in: doc.items.flatMap(i => i.internalProductId ? [i.internalProductId] : []) }, isActive: true, bom: { product: { accountId } } } });
        if ((!guarded) && (hasCascade || doc.items.some(i => i.productId))) return fail('Complete the guarded inventory cutover in Delivery Estimates settings before writing off Woo stock or internal BOM components.');
        const control = await tx.receiptAccount.findUnique({ where: { accountId } });
        if ((hasCascade || doc.items.some(i => i.productId)) && control?.capability === 'blocked') return fail('Guarded stock transport is blocked. Update/reconnect the Woo plugin and recover receipt transport before finalizing.');
        // Unsupported variable-parent cascades must be fixed rather than silently skipped.
        if (hasCascade || doc.items.some(i => i.productId)) {
            const unsupported = await tx.bOM.findFirst({ where: { variationId: 0, product: { accountId, rawData: { path: ['type'], equals: 'variable' } }, items: { some: { isActive: true, OR: [{ internalProductId: { not: null } }, { childProductId: { not: null } }] } } } });
            if (unsupported) return fail('Configure variation-level BOMs instead of variable-parent BOMs before finalizing write-offs.');
        }
        let totalCost = new Prisma.Decimal(0);
        for (const item of doc.items) {
            const line: Line = { productId: item.productId ?? undefined, variationId: item.variationId ?? undefined, internalProductId: item.internalProductId ?? undefined, quantity: item.quantity, unitCostOverride: item.unitCostOverride ?? undefined };
            const [snapshot] = await snapshots(tx, accountId, [line]);
            let stock: number; let operationId: string | null = null;
            if (item.internalProductId) {
                const rows = await tx.$queryRaw<Array<{ stock: number }>>`UPDATE "InternalProduct" SET "stockQuantity"="stockQuantity"-${item.quantity} WHERE id=${item.internalProductId} AND "accountId"=${accountId} AND "stockQuantity">=${item.quantity} RETURNING "stockQuantity" AS stock`;
                if (!rows[0]) return fail(`${item.name}: insufficient or unknown stock. Reduce the quantity and try again.`);
                stock = rows[0].stock;
                await tx.receiptAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
            } else {
                const result = await queueBomStockMovement(tx, accountId, { ledgerId: item.id, orderId: 0, writeOffId: id, productId: item.productId!, variationWooId: item.variationId, quantity: item.quantity });
                stock = result.stock; operationId = result.operationId;
            }
            totalCost = totalCost.plus(snapshot.totalCost);
            await tx.stockWriteOffItem.update({ where: { id: item.id }, data: { ...snapshot, stockBefore: stock + item.quantity, stockAfter: stock, operationId, cascadeState: item.internalProductId ? 'pending' : 'none' } });
            await tx.auditLog.create({ data: { accountId, userId: actorId, action: 'UPDATE', resource: item.internalProductId ? 'INTERNAL_PRODUCT' : 'PRODUCT', resourceId: item.internalProductId ?? item.productId!, source: 'MANUAL',
                previousValue: { stock_quantity: stock + item.quantity }, details: { stock_quantity: stock, movementType: 'STOCK_WRITE_OFF', reference: doc.reference, writeOffId: id, reason: doc.reason, variationWooId: item.variationId, actorId, operationId } } });
        }
        await tx.stockWriteOff.update({ where: { id }, data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedBy: actorId, totalCost } });
        await tx.auditLog.create({ data: { accountId, userId: actorId, action: 'UPDATE', resource: 'STOCK_WRITE_OFF', resourceId: id, previousValue: { status: 'DRAFT' }, details: { status: 'FINALIZED', reason: doc.reason, totalCost: totalCost.toString() } } });
        return getWriteOff(accountId, id, tx);
    }, { timeout: 30_000 });
}

export function writeOffWhere(accountId: string, query: Query): Prisma.StockWriteOffWhereInput {
    return { accountId, ...(query.status ? { status: query.status } : {}), ...(query.reason ? { reason: query.reason } : {}),
        ...(query.from || query.to ? { finalizedAt: { ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}) } } : {}) };
}

export async function listWriteOffs(accountId: string, query: Query, report = false) {
    const pageSize = report ? 500 : 25;
    return prisma.$transaction(async tx => {
        // An export cutoff is selected after outstanding finalizers commit. Reuse it
        // across pages so concurrent new documents cannot shift the export offsets.
        if (report) await lockDeliveryAccount(tx, accountId);
        const asOf = report ? query.asOf ?? new Date().toISOString() : undefined;
        if (asOf && new Date(asOf).getTime() > Date.now()) return fail('asOf must not be in the future.', 400);
        const where = writeOffWhere(accountId, { ...query, ...(report ? { status: 'FINALIZED' as const } : {}) });
        if (asOf) where.AND = [{ finalizedAt: { lt: new Date(asOf) } }];
        const finalized = { AND: [where, { status: 'FINALIZED' }] };
        const sums = await tx.stockWriteOffItem.aggregate({ where: { writeOff: finalized }, _sum: { quantity: true, totalCost: true } });
        const count = await tx.stockWriteOff.count({ where: finalized });
        const summary = { quantity: sums._sum.quantity ?? 0, totalCost: Number(sums._sum.totalCost ?? 0), count };
        if (report) {
            const total = await tx.stockWriteOffItem.count({ where: { writeOff: where } });
            const rows = await tx.stockWriteOffItem.findMany({ where: { writeOff: where }, include: { writeOff: true }, orderBy: [{ writeOff: { finalizedAt: 'desc' } }, { id: 'asc' }], skip: (query.page - 1) * pageSize, take: pageSize });
            return { items: rows.map(i => ({ id: i.writeOffId, itemId: i.id, reference: i.writeOff.reference, finalizedAt: i.writeOff.finalizedAt, reason: i.writeOff.reason, name: i.name, sku: i.sku, type: i.type, quantity: i.quantity, unitCost: Number(i.unitCost), totalCost: Number(i.totalCost) })), total, page: query.page, pageSize, asOf, summary };
        }
        const total = await tx.stockWriteOff.count({ where });
        const docs = await tx.stockWriteOff.findMany({ where, select: { id: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (query.page - 1) * pageSize, take: pageSize });
        const items = [];
        for (const doc of docs) items.push(await getWriteOff(accountId, doc.id, tx));
        return { items, total, page: query.page, pageSize, summary };
    }, { isolationLevel: report ? 'ReadCommitted' : 'RepeatableRead' });
}

export async function writeOffProducts(accountId: string, search: string) {
    // A bounded search picker, never an unbounded catalogue export.
    return prisma.$transaction(async tx => {
        // target() takes stock row locks; follow the same Account -> stock lock
        // order as finalization and catalogue freshness triggers.
        await lockDeliveryAccount(tx, accountId);
        const text = { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { sku: { contains: search, mode: 'insensitive' as const } }] };
        const products = await tx.wooProduct.findMany({ where: { accountId, ...text, AND: [activeProductWhere] }, orderBy: { id: 'asc' }, take: 100 });
        const variants = await tx.productVariation.findMany({ where: { product: { accountId, ...activeProductWhere }, OR: [{ sku: { contains: search, mode: 'insensitive' } }, { product: text }] }, orderBy: { id: 'asc' }, take: 100 });
        const internal = await tx.internalProduct.findMany({ where: { accountId, ...text }, orderBy: { id: 'asc' }, take: 100 });
        const candidates: Line[] = [...products.map(p => ({ productId: p.id, quantity: 1 })), ...variants.map(v => ({ productId: v.productId, variationId: v.wooId, quantity: 1 })), ...internal.map(p => ({ internalProductId: p.id, quantity: 1 }))];
        const items = [];
        for (const candidate of candidates) {
            try {
                const p = await target(tx, accountId, candidate);
                let unitCost: number | null = null;
                try { const cost = writeOffUnitCost(p.cogs, p.miscCosts); unitCost = cost == null ? null : Number(cost); } catch (error) { if (!(error as { statusCode?: number }).statusCode) throw error; }
                const { quantity: _quantity, ...ids } = candidate;
                items.push({ ...ids, name: p.name, sku: p.sku, stockQuantity: p.stockQuantity, type: p.type, unitCost });
            } catch (error) {
                if (!(error instanceof GuardedReceiptError) && !(error as { statusCode?: number }).statusCode) throw error;
            }
        }
        return { items };
    }, { timeout: 30_000 });
}
