import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { DeliveryEstimateService } from './service';
import { dirtyInbound, lockDeliveryAccount, recordIntent, recordProductIntent, recordSettingsIntent, recoverStrandedInbound } from './intents';

export const RESYNC_BATCH_SIZE = 25;
export const RESYNC_MAX_ATTEMPTS = 8;
export const RESYNC_MAX_BACKOFF_MS = 15 * 60_000;
const resetBuildFailure = () => ({ buildAttempts: 0, buildFailed: false, buildLastError: null, buildNextAttemptAt: new Date(), buildVersion: { increment: 1 } });

/** Constant work on the request path. Repeated requests coalesce into the running build. */
export async function enqueueDeliveryResync(accountId: string) {
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const control = await tx.deliverySyncAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
        const parked = await tx.deliveryInputSync.findFirst({ where: { accountId, status: { in: ['blocked', 'failed', 'plugin_update_required'] } }, select: { id: true } });
        const retry = !!parked || control.buildFailed || control.inboundFailed ||
            ['blocked', 'plugin_update_required'].includes(control.capabilityStatus) || control.inboundCapabilityStatus === 'plugin_update_required';
        if (retry) {
            await tx.deliverySyncAccount.update({ where: { accountId }, data: {
                ...(control.buildFailed ? resetBuildFailure() : {}),
                ...(control.inboundFailed ? { inboundFailed: false, inboundAttempts: 0, inboundLastError: null, inboundNextAttemptAt: new Date(), inboundVersion: { increment: 1 } } : {}),
                capabilityStatus: 'unknown', capabilityExpiresAt: null, inboundCapabilityStatus: 'unknown', capabilityDetails: Prisma.DbNull, lastDiagnostic: Prisma.DbNull,
                lastError: null, hasWork: true, nextAttemptAt: new Date(),
            } });
            await tx.deliveryInputSync.updateMany({ where: { accountId, status: { in: ['blocked', 'failed', 'plugin_update_required'] } },
                // Keep exact-revision evidence until the bounded builder/dispatch
                // consumes remote expiry, even when the local clock says fresh.
                data: { status: 'pending', attempts: 0, proofRebuilds: 0, lastError: null, nextAttemptAt: new Date() } });
            await recoverStrandedInbound(tx, accountId, { ...control, inboundFailed: false });
            return 'retrying' as const;
        }
        if (await recoverStrandedInbound(tx, accountId, control)) return 'retrying' as const;
        const unfinished = await tx.deliveryInputSync.findFirst({ where: { accountId, OR: [{ status: { not: 'synced' } }, { leaseExpiresAt: { gt: new Date() } }] }, select: { id: true } });
        const dirty = await tx.deliveryInboundDirtyTarget.findFirst({ where: { accountId }, select: { wooId: true } });
        if (control.resyncRequested || control.inboundRequested || control.inboundFullRequested || unfinished || dirty ||
            (control.leaseExpiresAt && control.leaseExpiresAt > new Date())) return 'already_running' as const;
        await dirtyInbound(tx, accountId);
        await tx.deliverySyncAccount.update({ where: { accountId }, data: {
            resyncRequested: true, resyncGeneration: { increment: 1 }, resyncPhase: 'products', resyncCursor: null,
            capabilityStatus: 'unknown', capabilityExpiresAt: null, capabilityDetails: Prisma.DbNull, lastDiagnostic: Prisma.DbNull, lastError: null, hasWork: true, nextAttemptAt: new Date(),
            ...resetBuildFailure(),
        } });
        // Settings are current immediately; transport remains gated until the build finishes.
        await recordSettingsIntent(tx, accountId);
        return 'queued' as const;
    });
}

/** One atomic page: snapshots and cursor commit together; a crash cannot skip a snapshot.
 * Account row locking serializes builders with explicit saves and repeated resync requests.
 */
export async function buildDeliveryResyncBatch(accountId: string, scanned?: { resyncGeneration: number; buildVersion: number; buildAttempts: number }) {
    // The scan checkpoint also fences failures before the transaction can read/lock the row.
    const attempt: { state?: { generation: number; version: number; failures: number } } = {
        state: scanned ? { generation: scanned.resyncGeneration, version: scanned.buildVersion, failures: scanned.buildAttempts } : undefined,
    };
    await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const control = await tx.deliverySyncAccount.findUnique({ where: { accountId } });
        if (!control?.resyncRequested || control.buildFailed || control.buildNextAttemptAt > new Date()) return;
        attempt.state = { generation: control.resyncGeneration, version: control.buildVersion, failures: control.buildAttempts };
        const generation = control.resyncGeneration;
        const cursor = control.resyncCursor;
        if (control.resyncPhase === 'products') {
            const products = await tx.wooProduct.findMany({
                where: { accountId, ...(cursor ? { id: { gt: cursor } } : {}), OR: [
                    { productionMinDays: { not: null } }, { variations: { some: { productionMinDays: { not: null } } } },
                ] }, select: { id: true, wooId: true }, orderBy: { id: 'asc' }, take: RESYNC_BATCH_SIZE,
            });
            for (const product of products) {
                const existing = await tx.deliveryInputSync.findUnique({ where: { accountId_scope_entityId: { accountId, scope: 'product', entityId: product.wooId } }, select: { resyncGeneration: true } });
                // A normal save during this build already recorded the current snapshot.
                if (existing?.resyncGeneration !== generation) {
                    await recordProductIntent(tx, accountId, await DeliveryEstimateService.getProduct(accountId, product.id, tx));
                }
            }
            await tx.deliverySyncAccount.update({ where: { accountId }, data: {
                lastBuildAt: new Date(),
                ...resetBuildFailure(),
                ...(products.length < RESYNC_BATCH_SIZE ? { resyncPhase: 'replay', resyncCursor: null } : { resyncCursor: products[products.length - 1].id }),
            } });
        } else {
            // Visit existing rows once, including cleared or deleted products excluded above.
            const rows = await tx.deliveryInputSync.findMany({
                where: { accountId, scope: 'product', resyncGeneration: { not: generation }, ...(cursor ? { id: { gt: cursor } } : {}) },
                orderBy: { id: 'asc' }, take: RESYNC_BATCH_SIZE,
            });
            for (const row of rows) {
                const product = await tx.wooProduct.findFirst({ where: { accountId, wooId: row.entityId }, select: { id: true } });
                if (product) await recordProductIntent(tx, accountId, await DeliveryEstimateService.getProduct(accountId, product.id, tx));
                else await recordIntent(tx, accountId, 'product', row.entityId, { wooId: row.entityId, productionMinDays: null, productionMaxDays: null, variations: [] });
            }
            await tx.deliverySyncAccount.update({ where: { accountId }, data: {
                lastBuildAt: new Date(),
                ...resetBuildFailure(),
                ...(rows.length < RESYNC_BATCH_SIZE ? { resyncRequested: false, resyncCursor: null, hasWork: true, nextAttemptAt: new Date() } : { resyncCursor: rows[rows.length - 1].id }),
            } });
        }
    }, { timeout: 15_000 }).catch(async error => {
        // The failed page was rolled back. Persist recovery state separately, fenced
        // against another worker's progress or an explicit retry after that rollback.
        const checkpoint = attempt.state;
        if (checkpoint) {
            const failures = checkpoint.failures + 1;
            const terminal = failures >= RESYNC_MAX_ATTEMPTS;
            await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, accountId);
                await tx.deliverySyncAccount.updateMany({
                    where: { accountId, resyncRequested: true, resyncGeneration: checkpoint.generation, buildVersion: checkpoint.version },
                    data: {
                        buildAttempts: failures, buildFailed: terminal, buildVersion: { increment: 1 }, lastBuildAt: new Date(),
                        buildNextAttemptAt: new Date(Date.now() + Math.min(RESYNC_MAX_BACKOFF_MS, 30_000 * 2 ** Math.min(failures - 1, 7))),
                        buildLastError: terminal ? 'Delivery input rebuild failed. Retry sync to resume.' : 'Delivery input rebuild failed. Retrying automatically.',
                    },
                });
            });
        }
        throw error;
    });
}

/** At most four pages per tick. Re-select oldest-served accounts between rounds so small
 * installations can use the budget without starving other accounts on larger installations.
 */
export async function drainDeliveryResyncs(limit = 4) {
    const failed: string[] = [];
    for (let budget = Math.min(4, Math.max(1, limit)); budget > 0;) {
        const accounts = await prisma.deliverySyncAccount.findMany({ where: { resyncRequested: true, buildFailed: false, buildNextAttemptAt: { lte: new Date() }, ...(failed.length ? { accountId: { notIn: failed } } : {}) }, orderBy: [{ lastBuildAt: 'asc' }, { accountId: 'asc' }], take: budget, select: { accountId: true, resyncGeneration: true, buildVersion: true, buildAttempts: true } });
        if (!accounts.length) break;
        budget -= accounts.length;
        const results = await Promise.allSettled(accounts.map(account => buildDeliveryResyncBatch(account.accountId, account)));
        // Failure state/backoff was persisted by the builder; avoid another slot this tick.
        for (let index = 0; index < results.length; index++) {
            if (results[index].status === 'rejected') {
                failed.push(accounts[index].accountId);
                Logger.warn('Delivery input rebuild failed', { accountId: accounts[index].accountId });
            }
        }
    }
}
