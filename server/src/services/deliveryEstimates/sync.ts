import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DeliveryInputSync } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';
import { dirtyInboundProducts, lockDeliveryAccount } from './intents';
import { enqueueDeliveryResync, drainDeliveryResyncs } from './resync';
import { drainInboundBuilds } from './inboundResync';

export const DELIVERY_LEASE_MS = 120_000;
const MAX_ATTEMPTS = 8;
const CAPABILITY_CACHE_MS = 60 * 60 * 1000;
const syncCapabilities = z.object({ schemaVersion: z.number().int().positive(), capabilities: z.object({ configurationSync: z.boolean(), inboundInputs: z.boolean().optional(), inboundReceiptSafety: z.boolean().optional() }) });

export async function deliverySyncStatus(accountId: string) {
    const control = await prisma.deliverySyncAccount.findUnique({ where: { accountId } });
    const launch = await prisma.receiptAccount.findUnique({ where: { accountId } });
    const groups = await prisma.deliveryInputSync.groupBy({ by: ['status'], where: { accountId }, _count: true });
    const counts = new Map(groups.map(group => [group.status, group._count]));
    const syncedCount = counts.get('synced') ?? 0;
    const pendingCount = groups.reduce((sum, group) => sum + (group.status === 'synced' ? 0 : group._count), 0) + (control?.resyncRequested ? 1 : 0) + (control?.inboundRequested ? 1 : 0);
    const latest = await prisma.deliveryInputSync.findFirst({ where: { accountId, lastAcknowledgedAt: { not: null } }, orderBy: { lastAcknowledgedAt: 'desc' }, select: { lastAcknowledgedAt: true } });
    const error = await prisma.deliveryInputSync.findFirst({ where: { accountId, lastError: { not: null } }, orderBy: { updatedAt: 'desc' }, select: { lastError: true } });
    const accountParked = control && ['blocked', 'plugin_update_required'].includes(control.capabilityStatus);
    const configurationSync = control?.resyncRequested ? (control.buildFailed ? 'failed' : 'pending') : control?.inboundRequested ? (control.inboundFailed ? 'failed' : 'pending') : accountParked ? control.capabilityStatus : ['blocked', 'plugin_update_required', 'failed', 'pending'].find(status => counts.has(status)) ?? (syncedCount ? 'synced' : 'not_requested');
    const buildError = control?.resyncRequested ? control.buildLastError : null;
    return { status: { configurationSync, storefrontActivated: launch?.active ?? false, receiptSafety: launch?.cutoverState === 'guarded' ? 'guarded' : 'unverified', inboundCapability: control?.inboundCapabilityStatus ?? 'unknown', pendingCount, syncedCount, lastAcknowledgedAt: latest?.lastAcknowledgedAt.toISOString() ?? null, lastError: launch?.controlError ?? buildError ?? control?.inboundLastError ?? control?.lastError ?? error?.lastError ?? null } };
}

/** Request work only; catalogue pagination happens in bounded background transactions. */
export async function requestDeliverySync(accountId: string) {
    await enqueueDeliveryResync(accountId);
    return deliverySyncStatus(accountId);
}

class SyncFailure extends Error {
    constructor(public status: string, message: string, public accountWide = false) { super(message); }
}

/** Both exact replays and newly applied revisions must acknowledge the exact envelope.
 * storefrontActivated:false means this input write did not activate; it is NOT live
 * activation status and must never be copied onto ReceiptAccount/control state.
 */
export function validDeliveryAck(value: unknown, job: DeliveryInputSync): boolean {
    const ack = value as Record<string, unknown> | null;
    return !!ack && ack.schemaVersion === 1 && ack.scope === job.scope && ack.entityId === job.entityId &&
        ack.revision === Number(job.desiredRevision) && ack.storedRevision === Number(job.desiredRevision) &&
        typeof ack.applied === 'boolean' && ack.storefrontActivated === false;
}

export async function dispatchDeliveryInput(candidate: DeliveryInputSync) {
    const now = new Date();
    const token = randomUUID();
    // One transport owner per account (also the capability probe single-flight owner).
    const control = await prisma.deliverySyncAccount.findUnique({ where: { accountId: candidate.accountId } });
    if (!control || control.resyncRequested || !['unknown', 'supported'].includes(control.capabilityStatus)) return;
    if (candidate.scope === 'inbound' && (control.inboundRequested || control.inboundCapabilityStatus === 'plugin_update_required')) return;
    const accountOwner = { accountId: candidate.accountId, leaseToken: token };
    const inboundFence = candidate.scope === 'inbound' ? { inboundVersion: control.inboundVersion, inboundGeneration: control.inboundGeneration, inboundRequested: false } : {};
    const accountVersion = { ...accountOwner, ...inboundFence, resyncGeneration: control.resyncGeneration, resyncRequested: false };
    const accountClaim = await prisma.deliverySyncAccount.updateMany({
        where: { accountId: candidate.accountId, resyncGeneration: control.resyncGeneration, resyncRequested: false,
            ...inboundFence,
            capabilityStatus: control.capabilityStatus, capabilityExpiresAt: control.capabilityExpiresAt,
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
        data: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS), lastServedAt: now },
    });
    if (!accountClaim.count) return;
    const owner = { id: candidate.id, leaseToken: token };
    const accountLease = { account: { deliverySyncAccount: { is: { leaseToken: token } } } };
    const sent = { ...owner, ...accountLease, desiredRevision: candidate.desiredRevision };
    try {
        const claimed = await prisma.deliveryInputSync.updateMany({
            where: { id: candidate.id, desiredRevision: candidate.desiredRevision, status: 'pending', nextAttemptAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
            data: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS) },
        });
        if (!claimed.count) return;
        // A save between scan and claim invalidates the claim; saves after claim stay pending.
        const woo = await WooService.forAccount(candidate.accountId).catch(error => {
            if (error instanceof Error && error.message === 'Account missing WooCommerce credentials') {
                throw new SyncFailure('blocked', 'Delivery authorization unavailable.', true);
            }
            throw error;
        });
        // Credential loading must not consume the transport's lease budget.
        if (Date.now() - now.getTime() > DELIVERY_LEASE_MS - 30_000) throw new Error('Lease budget exhausted');
        let inboundCapability = control.inboundCapabilityStatus;
        if (control.capabilityStatus !== 'supported' || !control.capabilityExpiresAt || control.capabilityExpiresAt <= now || (candidate.scope === 'inbound' && inboundCapability !== 'supported')) {
            const caps = syncCapabilities.safeParse(await woo.getDeliveryDiscovery('capabilities'));
            if (!caps.success) throw new SyncFailure('blocked', 'Invalid delivery capabilities.', true);
            if (caps.data.schemaVersion !== 1 || !caps.data.capabilities.configurationSync) {
                throw new SyncFailure('plugin_update_required', 'Update the Overseek WooCommerce plugin.', true);
            }
            inboundCapability = control.inboundCapabilityStatus === 'plugin_update_required' ? 'plugin_update_required' : caps.data.capabilities.inboundInputs === true ? 'supported' : 'plugin_update_required';
            const cached = await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, candidate.accountId);
                const result = await tx.deliverySyncAccount.updateMany({ where: accountVersion,
                    data: { capabilityStatus: 'supported', inboundCapabilityStatus: inboundCapability, capabilityExpiresAt: new Date(Date.now() + CAPABILITY_CACHE_MS), lastError: null } });
                if (result.count && inboundCapability === 'plugin_update_required') await tx.deliveryInputSync.updateMany({ where: { accountId: candidate.accountId, scope: 'inbound', status: { not: 'synced' } }, data: { status: 'plugin_update_required', lastError: 'Update the plugin for inbound inputs.' } });
                return result;
            });
            if (!cached.count) return;
        }
        if (candidate.scope === 'inbound' && inboundCapability !== 'supported') return;
        // Avoid sending a superseded enabled payload if a disable arrived during discovery.
        const current = await prisma.deliveryInputSync.findFirst({ where: sent, select: { id: true } });
        if (!current) return;
        if (!await prisma.deliverySyncAccount.findFirst({ where: accountVersion, select: { accountId: true } })) return;
        if (Date.now() - now.getTime() > DELIVERY_LEASE_MS - 15_000) throw new Error('Lease budget exhausted');
        const envelope = { schemaVersion: 1 as const, scope: candidate.scope, entityId: candidate.entityId, revision: Number(candidate.desiredRevision), payload: candidate.payload };
        if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > 512 * 1024) throw new SyncFailure('blocked', 'Delivery envelope exceeds size bound.');
        const ack = await woo.postDeliveryInputs(envelope);
        if (!validDeliveryAck(ack, candidate)) throw new SyncFailure('blocked', 'Invalid delivery acknowledgement.');
        // Record only the revision actually sent, then conditionally mark its desired state synced.
        await prisma.deliveryInputSync.updateMany({ where: { ...owner, ...accountLease, ackRevision: { lt: candidate.desiredRevision } }, data: { ackRevision: candidate.desiredRevision, lastAcknowledgedAt: new Date() } });
        await prisma.deliveryInputSync.updateMany({ where: sent, data: { status: 'synced', lastError: null, attempts: 0, proofRebuilds: 0 } });
    } catch (error) {
        const proofConflict = (error as { response?: { data?: { code?: string } } }).response?.data?.code === 'overseek_delivery_stale_proof';
        if (candidate.scope === 'inbound' && proofConflict && candidate.proofRebuilds < 3) {
            await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, candidate.accountId);
                const changed = await tx.deliveryInputSync.updateMany({ where: sent, data: { proofRebuilds: { increment: 1 }, status: 'pending', lastError: 'Receipt changed; bounded proof rebuild queued.' } });
                if (changed.count) await dirtyInboundProducts(tx, candidate.accountId, [candidate.entityId]);
            });
            return;
        }
        const code = (error as { response?: { status?: number } })?.response?.status;
        const attempts = candidate.attempts + 1;
        const status = error instanceof SyncFailure ? error.status : code === 404 ? 'plugin_update_required' :
            code && code >= 400 && code < 500 && ![408, 429].includes(code) ? 'blocked' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        const lastError = error instanceof SyncFailure ? error.message : status === 'plugin_update_required' ? 'Update the Overseek WooCommerce plugin.' : status === 'blocked' ? 'Delivery authorization, schema or revision rejected.' : 'Delivery transport unavailable.';
        // Persist account suppression once. Writers take the same lock, so later saves inherit it.
        if (candidate.scope === 'inbound' && code === 404 && !(error instanceof SyncFailure && error.accountWide)) {
            await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, candidate.accountId);
                const parked = await tx.deliverySyncAccount.updateMany({ where: accountVersion, data: { inboundCapabilityStatus: 'plugin_update_required' } });
                if (parked.count) await tx.deliveryInputSync.updateMany({ where: { accountId: candidate.accountId, scope: 'inbound', status: { not: 'synced' } }, data: { status: 'plugin_update_required', lastError } });
            });
        } else if ((error instanceof SyncFailure && error.accountWide) || [401, 403, 404].includes(code ?? 0)) {
            await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, candidate.accountId);
                const parked = await tx.deliverySyncAccount.updateMany({ where: accountVersion, data: { capabilityStatus: status, capabilityExpiresAt: null, lastError } });
                if (parked.count) await tx.deliveryInputSync.updateMany({ where: { accountId: candidate.accountId, status: { not: 'synced' } }, data: { status, lastError } });
            });
        }
        await prisma.deliveryInputSync.updateMany({ where: sent, data: { status, attempts, lastError, nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(attempts - 1, 7))) } });
    } finally {
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, candidate.accountId);
            await tx.deliveryInputSync.updateMany({ where: owner, data: { leaseToken: null, leaseExpiresAt: null } });
            const due = await tx.deliveryInputSync.findFirst({ where: { accountId: candidate.accountId, status: 'pending' }, orderBy: { nextAttemptAt: 'asc' }, select: { nextAttemptAt: true } });
            // Retry requests and saves cannot race this wake/sleep decision under the account lock.
            await tx.deliverySyncAccount.updateMany({ where: accountOwner, data: {
                leaseToken: null, leaseExpiresAt: null, hasWork: !!due, ...(due ? { nextAttemptAt: due.nextAttemptAt } : {}),
            } });
        });
    }
}

/** A completed empty build can leave a wake without an outbox. Re-read under the
 * writer lock rather than sleeping from the stale candidate scan. Transport claims
 * do not take that lock, so CAS the observed lease before changing scheduling state.
 */
export async function reconcileDeliveryDispatch(accountId: string) {
    await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const control = await tx.deliverySyncAccount.findUnique({ where: { accountId } });
        const now = new Date();
        if (!control || control.resyncRequested || (control.leaseExpiresAt && control.leaseExpiresAt > now)) return;
        const where = { accountId, status: 'pending',
            ...(control.inboundRequested || control.inboundCapabilityStatus === 'plugin_update_required' ? { scope: { not: 'inbound' } } : {}),
        };
        const next = await tx.deliveryInputSync.findFirst({ where: { ...where, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }, orderBy: { nextAttemptAt: 'asc' }, select: { nextAttemptAt: true } });
        // A crashed row owner may outlive its account lease; retain a recovery wake.
        const leased = next ? null : await tx.deliveryInputSync.findFirst({ where: { ...where, leaseExpiresAt: { gt: now } }, orderBy: { leaseExpiresAt: 'asc' }, select: { nextAttemptAt: true, leaseExpiresAt: true } });
        const nextAttemptAt = next?.nextAttemptAt ?? (leased ? new Date(Math.max(leased.nextAttemptAt.getTime(), leased.leaseExpiresAt!.getTime())) : null);
        await tx.deliverySyncAccount.updateMany({ where: { accountId, leaseToken: control.leaseToken, leaseExpiresAt: control.leaseExpiresAt,
            resyncGeneration: control.resyncGeneration, inboundVersion: control.inboundVersion,
        }, data: { hasWork: !!nextAttemptAt, lastServedAt: now, ...(nextAttemptAt ? { nextAttemptAt } : {}) } });
    });
}

/** Fair account scheduling with a total job budget, including repeat rounds for small stores. */
export async function drainDeliveryInputs(limit = 10) {
    await drainDeliveryResyncs();
    await drainInboundBuilds();
    for (let budget = Math.min(25, Math.max(1, limit)); budget > 0;) {
        const now = new Date();
        const accounts = await prisma.deliverySyncAccount.findMany({ where: {
            hasWork: true, resyncRequested: false, capabilityStatus: { in: ['unknown', 'supported'] }, nextAttemptAt: { lte: now },
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
            // An inbound-only rebuilding/parked account must not monopolize the oldest
            // dispatch slots while configuration work on other accounts waits.
            AND: [{ OR: [
                { inboundRequested: false, inboundCapabilityStatus: { not: 'plugin_update_required' } },
                { account: { deliveryInputSyncs: { some: { scope: { not: 'inbound' }, status: 'pending', nextAttemptAt: { lte: now } } } } },
            ] }],
        }, orderBy: [{ lastServedAt: 'asc' }, { accountId: 'asc' }], take: Math.min(5, budget), select: { accountId: true } });
        if (!accounts.length) break;
        budget -= accounts.length;
        const results = await Promise.allSettled(accounts.map(async account => {
            const candidate = await prisma.deliveryInputSync.findFirst({ where: { accountId: account.accountId, status: 'pending', AND: [{ OR: [{ scope: { not: 'inbound' } }, { account: { deliverySyncAccount: { is: { inboundRequested: false, inboundCapabilityStatus: { not: 'plugin_update_required' } } } } }] }], nextAttemptAt: { lte: new Date() }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }] }, orderBy: [{ priority: 'asc' }, { nextAttemptAt: 'asc' }] });
            if (candidate) await dispatchDeliveryInput(candidate);
            else await reconcileDeliveryDispatch(account.accountId);
        }));
        // Keep the scheduler's overlap guard held until every in-flight account has settled.
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
    }
}
