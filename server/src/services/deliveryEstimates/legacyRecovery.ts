import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';
import { dirtyInboundProducts, lockDeliveryAccount } from './intents';
import { LaunchConflict } from './launch';

export const legacyReviewSchema = z.object({ receivingPaused: z.literal(true), workersRestarted: z.literal(true) }).strict();
export const legacyResolutionSchema = legacyReviewSchema.extend({ actionId: z.string().uuid(), observationToken: z.string().min(1).max(750_000), reason: z.string().trim().min(5).max(1000),
    correctedInventoryIncludesLegacyWork: z.literal(true), acknowledgeUnobservableTargets: z.boolean(),
    legacyReceiptReversalConfirmed: z.literal(true).optional(),
}).strict();
const targetSchema = z.object({ productWooId: z.number().int().positive(), variationWooId: z.number().int().positive().nullable().optional() });

async function context(tx: Prisma.TransactionClient, accountId: string, jobId: string) {
    const job = await tx.receiptLegacyWork.findFirst({ where: { id: jobId, accountId } });
    if (!job) throw new LaunchConflict('Legacy job not found.');
    if (job.targets !== null) {
        const raw = Array.isArray(job.targets) ? job.targets : [];
        const parsed = raw.slice(0, 1000).map(t => targetSchema.safeParse(t));
        const targets = parsed.flatMap(t => t.success ? [{ productWooId: t.data.productWooId, variationWooId: t.data.variationWooId ?? null }] : [])
            .sort((a, b) => a.productWooId - b.productWooId || (a.variationWooId ?? 0) - (b.variationWooId ?? 0));
        return { job, targets, sourceIncomplete: !targets.length || raw.length > 1000 || parsed.some(t => !t.success) };
    }
    // Old rows did not persist affected targets. Current PO links are advisory only,
    // so explicit unobservable-work acknowledgment is mandatory even if they all resolve.
    const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: job.purchaseOrderId, purchaseOrder: { accountId } }, take: 1001, orderBy: { id: 'asc' },
        select: { variationWooId: true, product: { select: { wooId: true, accountId: true } } } });
    return { job, sourceIncomplete: true, targets: items.slice(0, 1000).filter(i => i.product?.accountId === accountId)
        .map(i => ({ productWooId: i.product!.wooId, variationWooId: i.variationWooId }))
        .sort((a, b) => a.productWooId - b.productWooId || (a.variationWooId ?? 0) - (b.variationWooId ?? 0)) };
}

async function freeze(tx: Prisma.TransactionClient, accountId: string, actorId: string) {
    await tx.receiptAccount.upsert({ where: { accountId }, create: { accountId, receivingFrozen: true, cutoverState: 'legacy_review', workersRestartedBy: actorId, workersRestartedAt: new Date(), controlAction: 'disable', controlRevision: 1 },
        update: { receivingFrozen: true, cutoverState: 'legacy_review', workersRestartedBy: actorId, workersRestartedAt: new Date(),
            controlAction: 'disable', controlRevision: { increment: 1 }, controlPayload: Prisma.DbNull, controlAttempts: 0, controlNextAttemptAt: new Date(), revalidationRequested: false,
            controlError: 'Legacy operator review in progress; receiving remains frozen until explicit cutover.' } });
}

export async function listLegacyReceipts(accountId: string, cursor?: string) {
    const rows = await prisma.receiptLegacyWork.findMany({ where: { accountId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 51 });
    return { jobs: rows.slice(0, 50).map(job => ({ ...job, originalTargetsAvailable: job.targets !== null,
        observationPath: `/api/delivery-estimates/receipts/legacy/${job.id}/observation`, reconciliationPath: `/api/delivery-estimates/receipts/legacy/${job.id}/reconcile` })), nextCursor: rows.length > 50 ? rows[49].id : null };
}

/** Historical LEGACY receipts have no proven delta list. Offer an explicit audited
 * count-correction/status reversal instead of guessing operations from today's PO.
 */
export async function requestLegacyPoReversalReview(accountId: string, purchaseOrderId: string, actorId: string) {
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const po = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, accountId }, select: { id: true, status: true } });
        if (!po) throw new LaunchConflict('Purchase order not found.');
        if (await tx.receiptCycle.findFirst({ where: { accountId, purchaseOrderId, active: true } })) throw new LaunchConflict('This PO has guarded receipt provenance; use its normal ledger reversal.');
        const id = `legacy_po_restore_${po.id}`;
        const old = await tx.receiptLegacyWork.findFirst({ where: { id, accountId } });
        if (old) return { accepted: true, jobId: old.id, state: old.state };
        if (po.status !== 'RECEIVED') throw new LaunchConflict('Only an untracked legacy RECEIVED purchase order needs this review.');
        if (await tx.receiptOperation.count({ where: { accountId, OR: [{ state: { notIn: ['applied', 'reconciled'] } }, { cascadeState: { not: 'done' } }] } })) throw new LaunchConflict('Settle current guarded inventory operations before reviewing a historical reversal.');
        await freeze(tx, accountId, actorId);
        await tx.receiptLegacyWork.create({ data: { id, accountId, purchaseOrderId, sourceType: 'purchase_order_reversal', sourceId: po.id } });
        return { accepted: true, jobId: id, state: 'pending' };
    });
}

export async function observeLegacyReceipt(accountId: string, jobId: string, actorId: string) {
    const data = await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const current = await context(tx, accountId, jobId);
        if (['drained', 'reconciling'].includes(current.job.state)) throw new LaunchConflict('Job is already drained or awaiting its reconciliation ACK.');
        await freeze(tx, accountId, actorId);
        return { schemaVersion: 1, jobId, targets: current.targets, sourceIncomplete: current.sourceIncomplete };
    });
    let result: unknown;
    try { result = await (await WooService.forAccount(accountId)).legacyReceipt('observe', data); }
    catch (error) {
        const detail = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
        throw new LaunchConflict(typeof detail === 'string' ? detail.slice(0, 1000) : 'Legacy observation unavailable. Receiving remains frozen; check Woo credentials/plugin availability and retry observation.');
    }
    const parsed = z.object({ schemaVersion: z.literal(1), jobId: z.literal(jobId), observationToken: z.string(), expiresAt: z.string(), owners: z.array(z.object({ stockOwnerWooId: z.number(), stockQuantity: z.number() })), unobservable: z.array(z.unknown()), sourceIncomplete: z.boolean() }).safeParse(result);
    if (!parsed.success) throw new LaunchConflict('Legacy observation unavailable or plugin upgrade required. Receiving remains frozen.');
    return parsed.data;
}

export async function requestLegacyResolution(accountId: string, jobId: string, actorId: string, input: z.infer<typeof legacyResolutionSchema>) {
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const current = await context(tx, accountId, jobId);
        const previous = current.job.reconciliation as Prisma.JsonObject | null;
        if (previous?.actionId === input.actionId) {
            if (Object.entries(input).some(([key, value]) => !isDeepStrictEqual(previous[key], value))) throw new LaunchConflict('Legacy action identity conflict.');
            if (current.job.state === 'reconciliation_failed') {
                // Authorized managers may recover a departed operator's lost ACK, but
                // replay the immutable ORIGINAL authority rather than impersonating/replacing it.
                await tx.receiptLegacyWork.update({ where: { id: jobId }, data: { state: 'reconciling', attempts: 0, nextAttemptAt: new Date() } });
                await tx.auditLog.create({ data: { accountId, action: 'UPDATE', resource: 'PURCHASE_ORDER', resourceId: current.job.purchaseOrderId,
                    source: 'MANUAL', details: { actionId: input.actionId, originalActorId: previous.actorId, retryRequestedBy: actorId, resolution: 'retry_original_legacy_attestation' } } });
            }
            return { accepted: true, jobId, actionId: input.actionId, state: current.job.state === 'reconciliation_failed' ? 'reconciling' : current.job.state };
        }
        if (['drained', 'reconciling'].includes(current.job.state)) throw new LaunchConflict('Legacy job is already drained or awaiting an ACK; replay the original action.');
        if (current.job.sourceType === 'purchase_order_reversal' && !input.legacyReceiptReversalConfirmed) throw new LaunchConflict('Explicitly confirm corrected inventory excludes the original legacy receipt effect and includes review of dependent BOM stock.');
        if (current.sourceIncomplete && !input.acknowledgeUnobservableTargets) throw new LaunchConflict('Original targets were not recorded; explicitly acknowledge review of unobservable inventory and dependent BOM work.');
        await freeze(tx, accountId, actorId);
        await tx.receiptLegacyWork.update({ where: { id: jobId }, data: { state: 'reconciling', attempts: 0, nextAttemptAt: new Date(), lastError: null,
            reconciliation: { schemaVersion: 1, jobId, targets: current.targets, sourceIncomplete: current.sourceIncomplete, actorId, ...input } } });
        return { accepted: true, jobId, actionId: input.actionId, state: 'reconciling' };
    });
}

/** Retries an attestation, never a legacy absolute stock write or delta. */
export async function drainLegacyResolutions() {
    const jobs = await prisma.receiptLegacyWork.findMany({ where: { state: 'reconciling', attempts: { lt: 8 }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: 'asc' }, take: 10 });
    for (const job of jobs) {
        const input = job.reconciliation as Prisma.JsonObject;
        const fence = { id: job.id, accountId: job.accountId, state: 'reconciling', reconciliation: { equals: input } };
        if (!(await prisma.receiptLegacyWork.updateMany({ where: { ...fence, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 120_000) } })).count) continue;
        try {
            const ack = await (await WooService.forAccount(job.accountId)).legacyReceipt('reconcile', input) as Record<string, unknown>;
            if (ack?.schemaVersion !== 1 || ack.jobId !== job.id || ack.actionId !== input.actionId || ack.state !== 'operator_attested_drained') throw new Error('Invalid legacy attestation ACK.');
            await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, job.accountId);
                const changed = await tx.receiptLegacyWork.updateMany({ where: fence, data: { state: 'drained', resolvedAt: new Date(), lastError: null } });
                if (!changed.count) return;
                if (job.sourceType === 'purchase_order_reversal' && job.sourceId) {
                    if (await tx.receiptCycle.findFirst({ where: { accountId: job.accountId, purchaseOrderId: job.sourceId, active: true } })) throw new LaunchConflict('A newer guarded receipt cycle exists; historical reversal cannot override it.');
                    const po = await tx.purchaseOrder.findFirst({ where: { accountId: job.accountId, id: job.sourceId }, include: { items: { select: { product: { select: { wooId: true } } } } } });
                    if (!po || !['RECEIVED', 'ORDERED'].includes(po.status)) throw new LaunchConflict('Purchase order status changed during historical reversal review.');
                    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'ORDERED' } });
                    await dirtyInboundProducts(tx, job.accountId, po.items.flatMap(item => item.product ? [item.product.wooId] : []));
                }
                if (job.sourceId && ['bom_consumption', 'bom_reversal'].includes(job.sourceType)) {
                    await tx.bOMDeductionLedger.updateMany({ where: { id: job.sourceId, accountId: job.accountId, guardedOperationId: null,
                        status: { in: job.sourceType === 'bom_reversal' ? ['EXECUTED', 'COMPLETED'] : ['EXECUTED'] } },
                        data: { status: job.sourceType === 'bom_reversal' ? 'REVERSED' : 'COMPLETED', ...(job.sourceType === 'bom_reversal' ? { rolledBackAt: new Date() } : {}) } });
                }
                await tx.auditLog.create({ data: { accountId: job.accountId, action: 'UPDATE', resource: 'PURCHASE_ORDER', resourceId: job.purchaseOrderId,
                    source: 'MANUAL', details: { ...input, resolution: 'operator_attested_legacy_drain_no_stock_replay', acknowledgment: ack as Prisma.InputJsonObject } } });
            });
        } catch (error) {
            const response = (error as { response?: { status?: number; data?: { message?: string; code?: string } } } | null)?.response;
            await prisma.receiptLegacyWork.updateMany({ where: { ...fence, attempts: job.attempts + 1 }, data: {
                state: (response?.status === 409 && response.data?.code !== 'overseek_legacy_busy') || job.attempts >= 7 ? 'reconciliation_failed' : 'reconciling',
                lastError: response?.data?.message?.slice(0, 1000) ?? 'Legacy ACK unavailable; retry the identical action. No stock operation was replayed.',
                nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** job.attempts)),
            } });
        }
    }
}
