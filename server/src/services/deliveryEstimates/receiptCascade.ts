import { randomUUID } from 'node:crypto';
import { prisma } from '../../utils/prisma';
import { dirtyInboundProducts, lockDeliveryAccount } from './intents';

export const CASCADE_LEASE_MS = 120_000;
const MAX_ATTEMPTS = 8;

/** Derived BOM recalculation only. This worker has no receipt prepare/apply transport. */
export async function dispatchReceiptCascade(accountId: string) {
    const token = randomUUID(); const now = new Date();
    const job = await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const control = await tx.receiptAccount.findUnique({ where: { accountId } });
        if (control?.cutoverState === 'legacy_review' && await tx.receiptLegacyWork.count({ where: { accountId, state: { not: 'drained' } } })) return null;
        const claimed = await tx.receiptAccount.updateMany({ where: { accountId, OR: [{ cascadeLeaseExpiresAt: null }, { cascadeLeaseExpiresAt: { lte: now } }] },
            data: { cascadeLeaseToken: token, cascadeLeaseExpiresAt: new Date(now.getTime() + CASCADE_LEASE_MS), cascadeLastServedAt: now } });
        if (!claimed.count) return null;
        const op = await tx.receiptOperation.findFirst({ where: { accountId, state: { in: ['applied', 'reconciled'] }, cascadeState: 'pending', cascadeNextAttemptAt: { lte: now } }, orderBy: [{ cascadeNextAttemptAt: 'asc' }, { createdAt: 'asc' }] });
        if (op) {
                if (op.cascadeAttempts >= MAX_ATTEMPTS) {
                    await tx.receiptOperation.update({ where: { operationId: op.operationId }, data: { cascadeState: 'failed', cascadeError: 'Cascade retry budget exhausted after an interrupted worker; retry cascade only.' } });
                    await tx.receiptAccount.updateMany({ where: { accountId, cascadeLeaseToken: token }, data: { cascadeLeaseToken: null, cascadeLeaseExpiresAt: null } });
                    return null;
                }
                await tx.receiptOperation.update({ where: { operationId: op.operationId }, data: { cascadeAttempts: { increment: 1 } } });
                return op;
        }
        await tx.receiptAccount.updateMany({ where: { accountId, cascadeLeaseToken: token }, data: { cascadeLeaseToken: null, cascadeLeaseExpiresAt: null } });
        return null;
    });
    if (!job) return;
    const accountFence = { accountId, cascadeLeaseToken: token };
    const renew = async () => prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const at = new Date();
        if (!await tx.receiptAccount.findFirst({ where: { ...accountFence, cascadeLeaseExpiresAt: { gt: at } } })) throw new Error('Receipt cascade lease lost; a current worker must resume.');
        const until = new Date(at.getTime() + CASCADE_LEASE_MS);
        await tx.receiptAccount.updateMany({ where: accountFence, data: { cascadeLeaseExpiresAt: until } });
    });
    let renewal: Promise<void> | null = null; let leaseError: unknown;
    const timer = setInterval(() => {
        if (renewal) return;
        renewal = renew().catch(error => { leaseError = error; }).finally(() => { renewal = null; });
    }, 30_000);
    timer.unref();
    try {
        const { BOMConsumptionService } = await import('../BOMConsumptionService');
        await BOMConsumptionService.cascadeSyncAffectedProducts(accountId, job.productId, job.variationWooId ?? undefined, 'wooProduct', new Set(), {
            strict: true,
            beforeWrite: async (productId, variationId) => {
                if (leaseError) throw leaseError;
                await renew();
                // No unguarded fallback to native PO owners: only current computed BOM
                // targets may be recalculated, and outstanding native intents must settle.
                const bom = await prisma.bOM.findFirst({ where: { productId, variationId, product: { accountId }, items: { some: { isActive: true,
                    OR: [{ childProductId: { not: null } }, { internalProductId: { not: null } }] } } }, select: { id: true, product: { select: { wooId: true } } } });
                if (!bom) throw new Error('Derived BOM target changed; retry cascade against the current definition.');
                const targetWooId = variationId || bom.product.wooId;
                const unsettled = await prisma.receiptOperation.count({ where: { accountId, OR: [
                    { stockOwnerWooId: targetWooId, OR: [{ state: { notIn: ['applied', 'reconciled'] } }, { cascadeState: { not: 'done' } }] },
                    ...(variationId ? [{ productId, variationWooId: variationId, state: { notIn: ['applied', 'reconciled'] } }] : []),
                ] } });
                if (unsettled) throw new Error('Derived BOM target has unsettled native receipt work; resolve it before cascade retry.');
            },
        });
        if (leaseError) throw leaseError;
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            const at = new Date();
            if (!await tx.receiptAccount.findFirst({ where: { ...accountFence, cascadeLeaseExpiresAt: { gt: at } } })) return;
            await tx.receiptOperation.update({ where: { operationId: job.operationId }, data: { cascadeState: 'done', cascadeError: null, cascadeCompletedAt: at } });
            const remaining = await tx.receiptOperation.count({ where: { accountId, stockOwnerWooId: job.stockOwnerWooId, state: { in: ['applied', 'reconciled'] }, cascadeState: { not: 'done' } } });
            await tx.receiptOwner.updateMany({ where: { accountId, stockOwnerWooId: job.stockOwnerWooId }, data: { cascadePending: remaining > 0 } });
            if (job.sourceType === 'bom_consumption' && job.sourceId) {
                await tx.bOMDeductionLedger.updateMany({ where: { id: job.sourceId, accountId, guardedOperationId: job.operationId, status: 'QUEUED_GUARDED' }, data: { status: 'COMPLETED' } });
            }
            await dirtyInboundProducts(tx, accountId, [job.productWooId]);
        });
    } catch (error) {
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            const at = new Date();
            if (!await tx.receiptAccount.findFirst({ where: { ...accountFence, cascadeLeaseExpiresAt: { gt: at } } })) return;
            await tx.receiptOperation.update({ where: { operationId: job.operationId }, data: {
                cascadeState: job.cascadeAttempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
                cascadeError: (error instanceof Error ? error.message : 'BOM cascade failed').slice(0, 1000),
                cascadeNextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** job.cascadeAttempts)),
            } });
        });
    } finally {
        clearInterval(timer); if (renewal) await renewal;
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            await tx.receiptAccount.updateMany({ where: accountFence, data: { cascadeLeaseToken: null, cascadeLeaseExpiresAt: null } });
        });
    }
}

export async function drainReceiptCascades() {
    const now = new Date();
    const accounts = await prisma.receiptAccount.findMany({ where: { OR: [{ cascadeLeaseExpiresAt: null }, { cascadeLeaseExpiresAt: { lte: now } }],
        account: { receiptOperations: { some: { state: { in: ['applied', 'reconciled'] }, cascadeState: 'pending', cascadeNextAttemptAt: { lte: now } } } },
    }, orderBy: [{ cascadeLastServedAt: 'asc' }, { accountId: 'asc' }], take: 5, select: { accountId: true } });
    for (const account of accounts) await dispatchReceiptCascade(account.accountId);
}

export async function retryReceiptCascade(accountId: string, operationId: string, actorId: string) {
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const op = await tx.receiptOperation.findFirst({ where: { accountId, operationId } });
        if (!op || !['applied', 'reconciled'].includes(op.state)) throw Object.assign(new Error('Receipt stock must be settled before retrying its cascade.'), { statusCode: 409 });
        if (op.cascadeState !== 'failed') return { accepted: true, operationId, cascadeState: op.cascadeState };
        await tx.receiptOperation.update({ where: { operationId }, data: { cascadeState: 'pending', cascadeAttempts: 0, cascadeNextAttemptAt: new Date(), cascadeError: null } });
        await tx.auditLog.create({ data: { accountId, action: 'UPDATE', resource: 'PRODUCT', resourceId: op.productId, source: 'MANUAL', details: { operationId, actorId, action: 'retry_bom_cascade_no_receipt_delta' } } });
        return { accepted: true, operationId, cascadeState: 'pending' };
    });
}
