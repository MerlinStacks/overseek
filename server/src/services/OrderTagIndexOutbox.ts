import crypto from 'node:crypto';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
/** Coalescing, durable search invalidations; always rebuild from the current account-bound order. */
export async function drainOrderTagIndexes(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new Error('Invalid outbox batch limit');
    const now = new Date();
    const jobs = await prisma.orderTagIndexOutbox.findMany({ where: { nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, orderBy: { nextAttemptAt: 'asc' }, take: limit });
    for (const job of jobs) {
        const owner = crypto.randomUUID();
        const claim = await prisma.orderTagIndexOutbox.updateMany({ where: { orderId: job.orderId, revision: job.revision, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 300000) } });
        if (claim.count !== 1) continue;
        try {
            const order = await prisma.wooOrder.findFirst({ where: { id: job.orderId, accountId: job.accountId } });
            if (order) {
                const raw = order.rawData && typeof order.rawData === 'object' && !Array.isArray(order.rawData) ? order.rawData : {};
                const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [];
                const { IndexingService } = await import('./search/IndexingService');
                await IndexingService.indexOrder(job.accountId, { ...raw, id: order.wooId }, tags, true, AbortSignal.timeout(15000));
            }
            const deleted = await prisma.orderTagIndexOutbox.deleteMany({ where: { orderId: job.orderId, accountId: job.accountId, revision: job.revision, leaseOwner: owner } });
            if (!deleted.count) await prisma.orderTagIndexOutbox.updateMany({ where: { orderId: job.orderId, leaseOwner: owner }, data: { leaseOwner: null, leaseUntil: null } });
        } catch {
            await prisma.orderTagIndexOutbox.updateMany({ where: { orderId: job.orderId, leaseOwner: owner }, data: { leaseOwner: null, leaseUntil: null, attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 10000 * 2 ** Math.min(job.attempts, 8))) } });
            Logger.warn('Order tag indexing deferred for retry', { accountId: job.accountId, orderId: job.orderId });
        }
    }
}
