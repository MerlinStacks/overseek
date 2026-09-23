import { randomUUID } from 'node:crypto';
import { prisma } from '../utils/prisma';
import { lockDeliveryAccount } from './deliveryEstimates/intents';
import { CASCADE_LEASE_MS } from './deliveryEstimates/receiptCascade';

/** Durable internal-component outbox. Shares the receipt cascade account lease,
 * and only recalculates derived BOM stock; it never replays a stock decrement.
 * Retries remain durable with capped backoff (including after process death).
 */
export async function dispatchWriteOffCascade(accountId: string) {
    const token = randomUUID(); const now = new Date();
    const job = await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const control = await tx.receiptAccount.findUnique({ where: { accountId } });
        if (control?.receivingFrozen) return null;
        const claimed = await tx.receiptAccount.updateMany({ where: { accountId, OR: [{ cascadeLeaseExpiresAt: null }, { cascadeLeaseExpiresAt: { lte: now } }] },
            data: { cascadeLeaseToken: token, cascadeLeaseExpiresAt: new Date(now.getTime() + CASCADE_LEASE_MS), cascadeLastServedAt: now } });
        if (!claimed.count) return null;
        const item = await tx.stockWriteOffItem.findFirst({ where: { writeOff: { accountId, status: 'FINALIZED' }, internalProductId: { not: null }, cascadeState: 'pending', cascadeNextAttemptAt: { lte: now } }, orderBy: [{ cascadeNextAttemptAt: 'asc' }, { id: 'asc' }] });
        if (!item) {
            await tx.receiptAccount.updateMany({ where: { accountId, cascadeLeaseToken: token }, data: { cascadeLeaseToken: null, cascadeLeaseExpiresAt: null } });
            return null;
        }
        await tx.stockWriteOffItem.update({ where: { id: item.id }, data: { cascadeAttempts: { increment: 1 }, cascadeNextAttemptAt: new Date(now.getTime() + CASCADE_LEASE_MS) } });
        return item;
    });
    if (!job) return;
    const fence = { accountId, cascadeLeaseToken: token };
    const renew = () => prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const count = await tx.receiptAccount.updateMany({ where: { ...fence, receivingFrozen: false, cascadeLeaseExpiresAt: { gt: new Date() } }, data: { cascadeLeaseExpiresAt: new Date(Date.now() + CASCADE_LEASE_MS) } });
        if (!count.count) throw new Error('Internal write-off cascade lease lost or receiving frozen; durable retry required.');
    });
    let renewal: Promise<void> | null = null; let leaseError: unknown;
    const timer = setInterval(() => { if (!renewal) renewal = renew().catch(error => { leaseError = error; }).finally(() => { renewal = null; }); }, 30_000);
    timer.unref();
    try {
        const { BOMConsumptionService } = await import('./BOMConsumptionService');
        await BOMConsumptionService.cascadeSyncAffectedProducts(accountId, job.internalProductId!, undefined, 'internalProduct', new Set(), {
            strict: true,
            beforeWrite: async (productId, variationId) => {
                if (leaseError) throw leaseError;
                await renew();
                const bom = await prisma.bOM.findFirst({ where: { productId, variationId, product: { accountId }, items: { some: { isActive: true, OR: [{ childProductId: { not: null } }, { internalProductId: { not: null } }] } } }, include: { product: true } });
                if (!bom) throw new Error('Derived BOM definition changed; retry against current inventory.');
                const raw = bom.product.rawData as { type?: string };
                if (!variationId && raw.type === 'variable') throw new Error('Configure variation-level BOMs instead of variable-parent BOMs.');
                const unsettled = await prisma.receiptOperation.count({ where: { accountId, OR: [
                    { stockOwnerWooId: variationId || bom.product.wooId, OR: [{ state: { notIn: ['applied', 'reconciled'] } }, { cascadeState: { not: 'done' } }] },
                    ...(variationId ? [{ productId, variationWooId: variationId, state: { notIn: ['applied', 'reconciled'] } }] : []),
                ] } });
                if (unsettled) throw new Error('Resolve outstanding native stock operations before the derived BOM cascade.');
            },
        });
        if (leaseError) throw leaseError;
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            if (!await tx.receiptAccount.findFirst({ where: { ...fence, receivingFrozen: false, cascadeLeaseExpiresAt: { gt: new Date() } } })) return;
            await tx.stockWriteOffItem.update({ where: { id: job.id }, data: { cascadeState: 'done', cascadeError: null } });
        });
    } catch (error) {
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            if (!await tx.receiptAccount.findFirst({ where: { ...fence, cascadeLeaseExpiresAt: { gt: new Date() } } })) return;
            await tx.stockWriteOffItem.update({ where: { id: job.id }, data: {
                cascadeError: (error instanceof Error ? error.message : 'Internal BOM cascade failed').slice(0, 1000),
                cascadeNextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(job.cascadeAttempts, 7))),
            } });
        });
    } finally {
        clearInterval(timer); if (renewal) await renewal;
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            await tx.receiptAccount.updateMany({ where: fence, data: { cascadeLeaseToken: null, cascadeLeaseExpiresAt: null } });
        });
    }
}

export async function drainWriteOffCascades() {
    const now = new Date();
    const accounts = await prisma.receiptAccount.findMany({ where: { receivingFrozen: false,
        OR: [{ cascadeLeaseExpiresAt: null }, { cascadeLeaseExpiresAt: { lte: now } }],
        account: { stockWriteOffs: { some: { status: 'FINALIZED', items: { some: { cascadeState: 'pending', cascadeNextAttemptAt: { lte: now } } } } } },
    }, orderBy: [{ cascadeLastServedAt: 'asc' }, { accountId: 'asc' }], take: 5, select: { accountId: true } });
    for (const { accountId } of accounts) await dispatchWriteOffCascade(accountId);
}
