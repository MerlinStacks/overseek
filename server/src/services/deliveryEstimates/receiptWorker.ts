import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';
import { dirtyInboundProducts, lockDeliveryAccount } from './intents';
import { parseReceiptAck, receiptOperationSchema } from './receiptProtocol';

export const RECEIPT_LEASE_MS = 120_000;
export const RECEIPT_MAX_ATTEMPTS = 8;
export const RECEIPT_CAPABILITY_MAX_ATTEMPTS = 8;
const retryDue = (attempts: number) => new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempts - 1)));
class Park extends Error {
    constructor(message: string, public accountWide = false, public uncertain = false) { super(message); }
}

/** One account transport lease suppresses capability probe storms across owners/processes.
 * Owner sequence/lease independently fences every state transition. Saves never clear leases.
 */
export async function dispatchGuardedReceipt(accountId: string) {
    const token = randomUUID();
    const now = new Date();
    const claim = await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const control = await tx.receiptAccount.findUnique({ where: { accountId } });
        if (control?.cutoverState === 'legacy_review' && await tx.receiptLegacyWork.count({ where: { accountId, state: { not: 'drained' } } })) return null;
        if (!control || !['unknown', 'supported'].includes(control.capability) || control.capabilityNextAttemptAt > now) return null;
        const accountClaim = await tx.receiptAccount.updateMany({ where: { accountId, capabilityNextAttemptAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
            data: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + RECEIPT_LEASE_MS), lastServedAt: now } });
        if (!accountClaim.count) return null;
        const owner = await tx.receiptOwner.findFirst({ where: { accountId, parked: false, nextAttemptAt: { lte: now },
            lastSequence: { gt: prisma.receiptOwner.fields.appliedSequence }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }, orderBy: [{ nextAttemptAt: 'asc' }, { stockOwnerWooId: 'asc' }] });
        const job = owner && await tx.receiptOperation.findUnique({ where: { accountId_stockOwnerWooId_sequence: { accountId, stockOwnerWooId: owner.stockOwnerWooId, sequence: owner.appliedSequence + 1n } } });
        if (!owner || !job) {
            await tx.receiptAccount.updateMany({ where: { accountId, leaseToken: token }, data: { leaseToken: null, leaseExpiresAt: null } });
            return null;
        }
        if (job.attempts >= RECEIPT_MAX_ATTEMPTS || !['pending', 'prepared'].includes(job.state)) {
            await tx.receiptOwner.update({ where: { accountId_stockOwnerWooId: { accountId, stockOwnerWooId: owner.stockOwnerWooId } }, data: { parked: true } });
            await tx.receiptOperation.update({ where: { operationId: job.operationId }, data: { state: 'parked', lastError: 'Retry budget exhausted or unresolved operation state.' } });
            await tx.receiptAccount.updateMany({ where: { accountId, leaseToken: token }, data: { leaseToken: null, leaseExpiresAt: null } });
            return null;
        }
        const acquired = await tx.receiptOwner.updateMany({ where: { accountId, stockOwnerWooId: owner.stockOwnerWooId, leaseToken: owner.leaseToken, appliedSequence: owner.appliedSequence },
            data: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + RECEIPT_LEASE_MS) } });
        if (!acquired.count) throw new Error('Receipt claim race');
        return { control, job };
    });
    if (!claim) return;
    const { job, control } = claim;
    const ownerFence = { accountId, stockOwnerWooId: job.stockOwnerWooId, leaseToken: token, leaseExpiresAt: { gt: new Date() }, appliedSequence: job.sequence - 1n };
    const accountFence = { accountId, leaseToken: token };
    // Lock Account before checking fences and changing owner/operation/projection atomically.
    const fenced = async (work: (tx: Prisma.TransactionClient) => Promise<void>) => prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        if (!await tx.receiptAccount.findFirst({ where: { ...accountFence, leaseExpiresAt: { gt: new Date() } } }) ||
            !await tx.receiptOwner.findFirst({ where: { ...ownerFence, leaseExpiresAt: { gt: new Date() } } })) return false;
        await work(tx);
        return true;
    });
    let capabilityReady = false;
    let operationAttempts = job.attempts;
    const capabilityAttempts = control.capabilityAttempts + 1;
    try {
        const parsed = receiptOperationSchema.safeParse({ operationId: job.operationId, sequence: Number(job.sequence), productWooId: job.productWooId,
            variationWooId: job.variationWooId, stockOwnerWooId: job.stockOwnerWooId, delta: job.delta });
        if (!parsed.success) throw new Park('Invalid immutable receipt operation.');
        const operation = parsed.data;
        const needsDiscovery = control.capability !== 'supported' || !control.capabilityExpiresAt || control.capabilityExpiresAt <= now;
        if (needsDiscovery) {
            if (control.capabilityAttempts >= RECEIPT_CAPABILITY_MAX_ATTEMPTS) throw new Park('Receipt capability retry budget exhausted.', true);
            // Reserve both attempt and due time before discovery: a process crash must
            // not reset the account probe budget or let another owner probe immediately.
            if (!await fenced(async tx => { await tx.receiptAccount.updateMany({ where: accountFence, data: {
                capabilityAttempts, capabilityNextAttemptAt: retryDue(capabilityAttempts),
            } }); })) return;
        }
        const woo = await WooService.forAccount(accountId).catch(error => {
            if (error?.message === 'Account missing WooCommerce credentials') throw new Park('Receipt authorization unavailable.', true);
            throw error;
        });
        if (needsDiscovery) {
            const caps = await woo.getDeliveryDiscovery('capabilities') as { schemaVersion?: unknown; capabilities?: { guardedReceipts?: unknown } } | null;
            if (caps?.schemaVersion !== 1 || caps.capabilities?.guardedReceipts !== true) throw new Park('Plugin guardedReceipts capability required.', true);
            if (!await fenced(async tx => { await tx.receiptAccount.updateMany({ where: accountFence, data: { capability: 'supported', capabilityExpiresAt: new Date(Date.now() + 3_600_000), capabilityAttempts: 0, capabilityNextAttemptAt: new Date(), lastError: null } }); })) return;
        }
        capabilityReady = true;
        // Every network call has a 10s timeout; leave sufficient time to persist its ACK.
        const canSend = () => Date.now() < now.getTime() + RECEIPT_LEASE_MS - 20_000;
        if (!canSend() || !await fenced(async tx => {
            // One receipt transport attempt may prepare then apply. Discovery failures
            // consume only the account budget, never any queued operation's budget.
            await tx.receiptOperation.update({ where: { operationId: job.operationId }, data: { attempts: { increment: 1 } } });
        })) return;
        operationAttempts++;
        let ack;
        if (job.state === 'pending') {
            ack = parseReceiptAck(await woo.postGuardedReceipt('prepare', operation), operation);
            if (!ack) throw new Park('Invalid prepare acknowledgement.');
            if (ack.state === 'uncertain') throw new Park('Plugin reports uncertain stock application.', false, true);
            if (ack.state === 'prepared' && !await fenced(async tx => {
                await tx.receiptOperation.update({ where: { operationId: job.operationId }, data: { state: 'prepared' } });
            })) return;
        }
        if (ack?.state !== 'applied') {
            if (!canSend() || !await fenced(async () => {})) return;
            ack = parseReceiptAck(await woo.postGuardedReceipt('apply', operation), operation);
            if (!ack || ack.state === 'prepared') throw new Park('Invalid apply acknowledgement.');
            if (ack.state === 'uncertain') throw new Park('Plugin reports uncertain stock application.', false, true);
        }
        await fenced(async tx => {
            await tx.receiptOperation.update({ where: { operationId: job.operationId }, data: { state: 'applied', stockQuantity: ack!.stockQuantity, appliedAt: new Date(), lastError: null,
                cascadeState: 'pending', cascadeAttempts: 0, cascadeNextAttemptAt: new Date(), cascadeError: null } });
            await tx.receiptOwner.updateMany({ where: ownerFence, data: { appliedSequence: job.sequence, cascadePending: true, nextAttemptAt: new Date() } });
            await dirtyInboundProducts(tx, accountId, [job.productWooId]);
        });
    } catch (error) {
        const response = (error as { response?: { status?: number; data?: { code?: unknown } } })?.response;
        const code = response?.status;
        const busy = code === 409 && response?.data?.code === 'overseek_receipt_busy';
        const transient = !(error instanceof Park) && !(error instanceof Prisma.PrismaClientValidationError) &&
            (code === undefined || code === 408 || code === 429 || (code >= 500 && code < 600) || busy);
        if (!capabilityReady && transient) {
            await fenced(async tx => {
                await tx.receiptAccount.updateMany({ where: accountFence, data: {
                    capability: capabilityAttempts >= RECEIPT_CAPABILITY_MAX_ATTEMPTS ? 'blocked' : 'unknown',
                    capabilityExpiresAt: null, capabilityAttempts, capabilityNextAttemptAt: retryDue(capabilityAttempts),
                    lastError: capabilityAttempts >= RECEIPT_CAPABILITY_MAX_ATTEMPTS ? 'Receipt capability retry budget exhausted.' : 'Receipt capability discovery unavailable; account retry scheduled.',
                } });
            });
            return;
        }
        const accountWide = (error instanceof Park && error.accountWide) || [401, 403, 404].includes(code ?? 0);
        const parked = !transient || operationAttempts >= RECEIPT_MAX_ATTEMPTS;
        const lastError = error instanceof Park ? error.message : parked ? 'Receipt transport rejected or retry budget exhausted.' : 'Receipt transport unavailable; replay same immutable operation.';
        const due = retryDue(operationAttempts);
        await fenced(async tx => {
            if (accountWide) await tx.receiptAccount.updateMany({ where: accountFence, data: { capability: 'blocked', lastError } });
            await tx.receiptOwner.updateMany({ where: ownerFence, data: { parked, nextAttemptAt: due } });
            await tx.receiptOperation.update({ where: { operationId: job.operationId }, data: { ...(parked ? { state: error instanceof Park && error.uncertain ? 'uncertain' : 'parked' } : {}), nextAttemptAt: due, lastError } });
        });
    } finally {
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            await tx.receiptOwner.updateMany({ where: { accountId, stockOwnerWooId: job.stockOwnerWooId, leaseToken: token }, data: { leaseToken: null, leaseExpiresAt: null } });
            await tx.receiptAccount.updateMany({ where: accountFence, data: { leaseToken: null, leaseExpiresAt: null } });
        });
    }
}

/** Bounded, fair account selection. Display settings and current mode do not cancel intent. */
export async function drainGuardedReceipts(limit = 10) {
    const now = new Date();
    const accounts = await prisma.receiptAccount.findMany({ where: { capability: { in: ['unknown', 'supported'] }, capabilityNextAttemptAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        account: { receiptOwners: { some: { parked: false, nextAttemptAt: { lte: now }, operations: { some: { state: { in: ['pending', 'prepared'] } } } } } },
    }, orderBy: [{ lastServedAt: 'asc' }, { accountId: 'asc' }], take: Math.min(25, Math.max(1, Math.trunc(limit) || 10)), select: { accountId: true } });
    for (const account of accounts) await dispatchGuardedReceipt(account.accountId);
}
