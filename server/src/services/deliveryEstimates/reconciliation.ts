import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';
import { dirtyInboundProducts, lockDeliveryAccount } from './intents';
import { LaunchConflict } from './launch';

export const reconciliationSchema = z.object({ actionId: z.string().uuid(), observationToken: z.string().min(1).max(12000), observedStockQuantity: z.number().int().safe(), reason: z.string().trim().min(5).max(1000), correctedCountIncludesOperation: z.literal(true) }).strict();
const operationWire = (op: { operationId: string; sequence: bigint; productWooId: number; variationWooId: number | null; stockOwnerWooId: number; delta: number }) => ({ operationId: op.operationId, sequence: Number(op.sequence), productWooId: op.productWooId, variationWooId: op.variationWooId, stockOwnerWooId: op.stockOwnerWooId, delta: op.delta });
export async function listReceipts(accountId: string, cursor?: string) {
    const rows = await prisma.receiptOperation.findMany({ where: { accountId, ...(cursor ? { operationId: { gt: cursor } } : {}) }, orderBy: { operationId: 'asc' }, take: 51 });
    const legacyJobs = await prisma.receiptLegacyWork.findMany({ where: { accountId, state: { not: 'drained' } }, orderBy: { createdAt: 'asc' }, take: 50 });
    return { receipts: rows.slice(0, 50).map(op => ({ ...op, sequence: String(op.sequence), cascadeRetryPath: op.cascadeState === 'failed' ? `/api/delivery-estimates/receipts/${op.operationId}/cascade/retry` : null })), nextCursor: rows.length > 50 ? rows[49].operationId : null, legacyJobs };
}
export async function listReceiptCycles(accountId: string, purchaseOrderId?: string, cursor?: string) {
    const rows = await prisma.receiptCycle.findMany({ where: { accountId, ...(purchaseOrderId ? { purchaseOrderId } : {}), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 51 });
    return { cycles: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
}
export async function observeReceipt(accountId: string, operationId: string) {
    const op = await prisma.receiptOperation.findFirst({ where: { accountId, operationId, state: { in: ['uncertain', 'parked', 'reconciliation_failed'] } } });
    if (!op) throw new LaunchConflict('A parked/uncertain operation is required.');
    return (await WooService.forAccount(accountId)).reconcileReceipt('observe', { operation: operationWire(op) });
}
export async function requestReconciliation(accountId: string, operationId: string, actorId: string, input: z.infer<typeof reconciliationSchema>) {
    await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const op = await tx.receiptOperation.findFirst({ where: { accountId, operationId }, include: { owner: true } });
        if (!op) throw new LaunchConflict('Receipt not found.');
        const request = { operation: operationWire(op), actorId, ...input };
        const previous = op.reconciliation as Prisma.JsonObject | null;
        if (previous?.actionId === input.actionId) {
            if (!isDeepStrictEqual(previous, { ...request, actorId: previous.actorId })) throw new LaunchConflict('Action identity conflict.');
            if (op.state === 'reconciliation_failed') {
                await tx.receiptOperation.update({ where: { operationId }, data: { state: 'reconciling', attempts: 0, nextAttemptAt: new Date() } });
                await tx.auditLog.create({ data: { accountId, action: 'UPDATE', resource: 'PRODUCT', resourceId: op.productId, source: 'MANUAL',
                    details: { actionId: input.actionId, originalActorId: previous.actorId, retryRequestedBy: actorId, resolution: 'retry_original_receipt_attestation' } } });
            }
            return;
        }
        if (!['uncertain', 'parked', 'reconciliation_failed'].includes(op.state) || op.owner.appliedSequence + 1n !== op.sequence || (op.owner.leaseExpiresAt && op.owner.leaseExpiresAt > new Date())) throw new LaunchConflict('Owner is busy or operation is not next in sequence.');
        await tx.receiptOwner.update({ where: { accountId_stockOwnerWooId: { accountId, stockOwnerWooId: op.stockOwnerWooId } }, data: { parked: true } });
        await tx.receiptOperation.update({ where: { operationId }, data: { state: 'reconciling', reconciliation: request, attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    });
    return { accepted: true, operationId, actionId: input.actionId };
}

export async function drainReconciliations() {
    const jobs = await prisma.receiptOperation.findMany({ where: { state: 'reconciling', attempts: { lt: 8 }, nextAttemptAt: { lte: new Date() } }, take: 10 });
    for (const op of jobs) {
        const claimed = await prisma.receiptOperation.updateMany({ where: { operationId: op.operationId, state: 'reconciling', attempts: op.attempts, nextAttemptAt: op.nextAttemptAt }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 120_000) } });
        if (!claimed.count) continue;
        try {
            const input = op.reconciliation as Prisma.JsonObject;
            const ack = await (await WooService.forAccount(op.accountId)).reconcileReceipt('reconcile', input) as Record<string, unknown>;
            if (ack?.schemaVersion !== 1 || ack.operationId !== op.operationId || ack.actionId !== input.actionId || ack.sequence !== Number(op.sequence) || ack.stockOwnerWooId !== op.stockOwnerWooId || ack.state !== 'reconciled' || ack.stockQuantity !== input.observedStockQuantity) throw new Error('Invalid reconciliation ACK.');
            await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, op.accountId);
                const current = await tx.receiptOperation.findFirst({ where: { operationId: op.operationId, accountId: op.accountId, state: 'reconciling', reconciliation: { equals: input } } });
                if (!current) return;
                const owner = await tx.receiptOwner.updateMany({ where: { accountId: op.accountId, stockOwnerWooId: op.stockOwnerWooId, appliedSequence: op.sequence - 1n, parked: true }, data: { appliedSequence: op.sequence, parked: false, cascadePending: true, nextAttemptAt: new Date() } });
                if (!owner.count) throw new LaunchConflict('Owner sequence changed.');
                await tx.receiptOperation.update({ where: { operationId: op.operationId }, data: { state: 'reconciled', appliedAt: new Date(), stockQuantity: Number(ack.stockQuantity), lastError: null,
                    cascadeState: 'pending', cascadeAttempts: 0, cascadeNextAttemptAt: new Date(), cascadeError: null } });
                await tx.receiptAccount.update({ where: { accountId: op.accountId }, data: { capability: 'unknown', capabilityAttempts: 0, capabilityExpiresAt: null, capabilityNextAttemptAt: new Date(), lastError: null } });
                await tx.auditLog.create({ data: { accountId: op.accountId, action: 'UPDATE', resource: 'PRODUCT', resourceId: op.productId, source: 'MANUAL', details: { ...input, resolution: 'operator_attested_no_delta_replay' } } });
                await dirtyInboundProducts(tx, op.accountId, [op.productWooId]);
            });
        } catch (error) {
            const status = (error as { response?: { status?: number } } | null)?.response?.status;
            await prisma.receiptOperation.updateMany({ where: { operationId: op.operationId, state: 'reconciling', attempts: op.attempts + 1 }, data: { state: status === 409 || op.attempts >= 7 ? 'reconciliation_failed' : 'reconciling', lastError: status === 409 ? 'Observation rejected; obtain a fresh corrected-stock observation.' : 'Reconciliation ACK unavailable; retrying the same action without stock mutation.', nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** op.attempts)) } });
        }
    }
}
