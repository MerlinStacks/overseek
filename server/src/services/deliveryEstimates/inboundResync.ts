import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { buildInbound } from './inbound';
import { configuredInboundProducts, ensureSettingsIntent, lockDeliveryAccount, recordIntent, recordProductIntent } from './intents';
import { renewInboundInputs, wakeInboundTargets } from './inboundRenewal';

export const INBOUND_PAGE_SIZE = 10;
export const INBOUND_MAX_ATTEMPTS = 8;
type Checkpoint = { inboundVersion: number; inboundAttempts: number };

/** Snapshot + outbox + cursor commit atomically. Account-locked service writers and
 * transactional source triggers both leave durable versioned targets for races. */
export async function buildInboundBatch(accountId: string, scanned?: Checkpoint) {
    let checkpoint = scanned;
    try {
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            const control = await tx.deliverySyncAccount.findUnique({ where: { accountId } });
            if (!control?.inboundRequested || control.inboundFailed || control.inboundNextAttemptAt > new Date()) return;
            checkpoint = control;
            const generation = control.inboundBuildGeneration || control.inboundGeneration;
            const cursor = control.inboundCursor;
            const record = async (wooId: number, snapshotGeneration = generation) => {
                await ensureSettingsIntent(tx, accountId);
                // Reconcile topology and deletion clears with the same durable target.
                const product = await tx.wooProduct.findFirst({ where: { accountId, wooId }, select: {
                    wooId: true, productionMinDays: true, productionMaxDays: true,
                    variations: { where: { deliveryActive: true }, take: 1001, orderBy: { wooId: 'asc' }, select: { wooId: true, productionMinDays: true, productionMaxDays: true } },
                } });
                await recordProductIntent(tx, accountId, product ?? { wooId, productionMinDays: null, productionMaxDays: null, variations: [] }, true);
                await recordIntent(tx, accountId, 'inbound', wooId, await buildInbound(tx, accountId, wooId));
                await tx.deliveryInputSync.update({ where: { accountId_scope_entityId: { accountId, scope: 'inbound', entityId: wooId } }, data: { inboundGeneration: snapshotGeneration } });
            };
            const common = { inboundLastBuildAt: new Date(), inboundVersion: { increment: 1 }, inboundAttempts: 0, inboundLastError: null, inboundNextAttemptAt: new Date(), inboundBuildGeneration: generation };
            const targets = await tx.deliveryInboundDirtyTarget.findMany({ where: { accountId }, orderBy: [{ createdAt: 'asc' }, { wooId: 'asc' }], take: INBOUND_PAGE_SIZE });
            if (targets.length) {
                for (const target of targets) {
                    await record(target.wooId, control.inboundGeneration);
                    // CAS also protects a re-dirty if locking behaviour changes later.
                    await tx.deliveryInboundDirtyTarget.deleteMany({ where: { accountId, wooId: target.wooId, version: target.version } });
                }
                const remaining = await tx.deliveryInboundDirtyTarget.findFirst({ where: { accountId }, select: { wooId: true } });
                await tx.deliverySyncAccount.update({ where: { accountId }, data: {
                    ...common, inboundBuildGeneration: control.inboundBuildGeneration,
                    inboundRequested: control.inboundFullRequested || !!remaining, hasWork: true, nextAttemptAt: new Date(),
                } });
                // Reserve a bounded full-pass page too: continuous dirty targets must
                // not starve configured products that have not yet been visited.
                if (!control.inboundFullRequested) return;
            }
            if (!control.inboundFullRequested) {
                await tx.deliverySyncAccount.update({ where: { accountId }, data: { ...common, inboundBuildGeneration: 0, inboundRequested: false, hasWork: true, nextAttemptAt: new Date() } });
                return;
            }
            if (control.inboundPhase === 'products') {
                // Only manual/supplier fanout uses this scan; untouched products never enrol.
                const products = await tx.wooProduct.findMany({ where: { accountId, ...configuredInboundProducts, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: INBOUND_PAGE_SIZE, select: { id: true, wooId: true } });
                for (const product of products) await record(product.wooId, control.inboundGeneration);
                await tx.deliverySyncAccount.update({ where: { accountId }, data: { ...common,
                    ...(products.length < INBOUND_PAGE_SIZE ? { inboundPhase: 'replay', inboundCursor: null } : { inboundCursor: products[products.length - 1].id }),
                } });
            } else {
                // Previously projected products survive deletion as empty replacements.
                const rows = await tx.deliveryInputSync.findMany({ where: { accountId, scope: 'inbound', inboundGeneration: { not: generation }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: INBOUND_PAGE_SIZE, select: { id: true, entityId: true } });
                for (const row of rows) await record(row.entityId, control.inboundGeneration);
                const finished = rows.length < INBOUND_PAGE_SIZE;
                const remaining = finished ? await tx.deliveryInboundDirtyTarget.findFirst({ where: { accountId }, select: { wooId: true } }) : null;
                await tx.deliverySyncAccount.update({ where: { accountId }, data: { ...common,
                    ...(finished ? { inboundRequested: control.inboundGeneration !== generation || !!remaining, inboundFullRequested: control.inboundGeneration !== generation, inboundBuildGeneration: 0, inboundPhase: 'products', inboundCursor: null, hasWork: true, nextAttemptAt: new Date() }
                        : { inboundCursor: rows[rows.length - 1].id }),
                } });
            }
        }, { timeout: 15_000 });
    } catch (error) {
        if (checkpoint) {
            const attempt = checkpoint.inboundAttempts + 1;
            const version = checkpoint.inboundVersion;
            await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, accountId);
                await tx.deliverySyncAccount.updateMany({ where: { accountId, inboundRequested: true, inboundVersion: version }, data: {
                    inboundAttempts: attempt, inboundFailed: attempt >= INBOUND_MAX_ATTEMPTS, inboundVersion: { increment: 1 }, inboundLastBuildAt: new Date(),
                    inboundNextAttemptAt: new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(attempt - 1, 7))),
                    inboundLastError: attempt >= INBOUND_MAX_ATTEMPTS ? 'Inbound rebuild failed. Retry sync to resume.' : 'Inbound rebuild failed. Retrying automatically.',
                } });
            });
        }
        throw error;
    }
}

export async function drainInboundBuilds(limit = 4) {
    await renewInboundInputs();
    await wakeInboundTargets();
    const failed: string[] = [];
    for (let budget = Math.min(4, Math.max(1, limit)); budget > 0;) {
        const accounts = await prisma.deliverySyncAccount.findMany({ where: { inboundRequested: true, inboundFailed: false, capabilityStatus: { in: ['unknown', 'supported'] }, inboundCapabilityStatus: { not: 'plugin_update_required' }, OR: [{ account: { features: { none: { featureKey: 'DELIVERY_ESTIMATES', isEnabled: false } } } }, { account: { deliveryInboundDirtyTargets: { some: {} } } }], inboundNextAttemptAt: { lte: new Date() }, ...(failed.length ? { accountId: { notIn: failed } } : {}) }, orderBy: [{ inboundLastBuildAt: 'asc' }, { accountId: 'asc' }], take: budget, select: { accountId: true, inboundVersion: true, inboundAttempts: true } });
        if (!accounts.length) break;
        budget -= accounts.length;
        const results = await Promise.allSettled(accounts.map(account => buildInboundBatch(account.accountId, account)));
        results.forEach((result, index) => {
            if (result.status === 'rejected') { failed.push(accounts[index].accountId); Logger.warn('Inbound rebuild failed', { accountId: accounts[index].accountId }); }
        });
    }
}
