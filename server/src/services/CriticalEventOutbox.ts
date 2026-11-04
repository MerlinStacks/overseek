import { createHash, randomUUID } from 'crypto';
import type { Prisma, ScopedOperation } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { EventBus, EVENTS } from './events';
import { EVENT_LIMITS } from '../config/limits';
import { z } from 'zod';

const automation: Record<string, string[]> = {
    'order:paid': ['ORDER_CREATED', 'ORDER_PAID'], 'order:completed': ['ORDER_COMPLETED'], 'order:first': ['FIRST_ORDER'], 'order:status_changed': ['ORDER_STATUS_CHANGED'],
    'artwork:uploaded': ['ARTWORK_UPLOADED'], 'artwork:approval_requested': ['ARTWORK_UPLOADED', 'ARTWORK_APPROVAL_REQUESTED'], 'artwork:approved': ['ARTWORK_APPROVED'], 'artwork:changes_requested': ['ARTWORK_CHANGES_REQUESTED'], 'artwork:override_used': ['ARTWORK_OVERRIDE_USED'],
    'customer:created': ['CUSTOMER_CREATED'], 'review:left': ['REVIEW_LEFT'],
    ...Object.fromEntries(['received_by_carrier', 'in_transit', 'out_for_delivery', 'delivery_attempted', 'delivered', 'exception'].map(name => [`shipment:${name}`, [`SHIPMENT_${name.toUpperCase()}`]])),
};
const notifications: Record<string, string> = { 'order:created': 'created', 'order:status_changed': 'status', 'review:left': 'review' };
const rowSchema = z.object({ event: z.string(), payload: z.record(z.string(), z.unknown()), digest: z.string().regex(/^[a-f0-9]{64}$/), subscribers: z.array(z.string()).min(1).max(20), state: z.enum(['pending', 'dispatching', 'complete', 'uncertain']) });
/** Called INSIDE the source state transaction. No customer/provider work here.
 * The producer transition itself supplies uniqueness; retries cannot recreate a
 * transition once its persisted previous state has advanced. */
export async function recordCriticalEvent(tx: Prisma.TransactionClient, event: string, payload: Record<string, unknown>, occurrenceId: string = randomUUID()) {
    const accountId = z.string().min(1).max(200).parse(payload.accountId);
    const subscribers = [...(automation[event] ?? []).map(name => `automation:${name}`), ...(notifications[event] ? [`notification:${notifications[event]}`] : [])];
    if (!subscribers.length) return;
    const sourceIdentity = z.string().min(1).max(1000).parse(occurrenceId);
    const boundedOccurrence = createHash('sha256').update(sourceIdentity).digest('hex');
    const safe = JSON.parse(JSON.stringify({ ...payload, occurrenceId: boundedOccurrence }));
    if (Buffer.byteLength(JSON.stringify(safe)) > 1024 * 1024) throw new Error('Critical event payload exceeds bounds');
    const id = `critical-event:${createHash('sha256').update(JSON.stringify([accountId, event, boundedOccurrence])).digest('hex')}`;
    const digest = createHash('sha256').update(JSON.stringify(safe)).digest('hex');
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const previous = await tx.scopedOperation.findUnique({ where: { id } });
    if (previous) { if ((previous.result as any).digest !== digest) throw new Error('Critical occurrence payload conflict'); return; }
    await tx.scopedOperation.create({ data: { id, accountId, kind: 'critical-event-outbox', result: { event, payload: safe, subscribers, digest, state: 'pending' } } });
}

export async function recordOrderLifecycle(tx: Prisma.TransactionClient, accountId: string, order: Record<string, any>, previousStatus: string | null, baseline = false) {
    const status = String(order.status).toLowerCase().replace(/^wc-/, '');
    const changed = previousStatus !== null && previousStatus !== status;
    const lifecycle = changed || previousStatus === null && !baseline;
    const payload = { accountId, order };
    const created = Date.parse(order.date_created_gmt || order.date_created || '');
    if (previousStatus === null && !baseline && Number.isFinite(created) && Date.now() - created >= 0 && Date.now() - created < 86400000) await recordCriticalEvent(tx, EVENTS.ORDER.CREATED, payload);
    if (changed) await recordCriticalEvent(tx, EVENTS.ORDER.STATUS_CHANGED, { ...payload, previousStatus, newStatus: status });
    if (lifecycle && ['processing', 'on-hold'].includes(status)) await recordCriticalEvent(tx, EVENTS.ORDER.PAID, payload);
    if (lifecycle && status === 'completed') await recordCriticalEvent(tx, EVENTS.ORDER.COMPLETED, payload);
    if (previousStatus === null && !baseline) {
        const email = typeof order.billing?.email === 'string' ? order.billing.email.trim().toLowerCase() : '';
        if (email && await tx.wooOrder.count({ where: { accountId, billingEmail: email } }) === 1) await recordCriticalEvent(tx, EVENTS.ORDER.FIRST, payload);
    }
}

type CriticalEventValue = z.infer<typeof rowSchema>;
/** Claims one pending receipt immediately before its own dispatch, so a crash can
 * never leave more receipts in `dispatching` than this function has reached. */
async function claimCriticalEvent(row: { id: string }, value: CriticalEventValue): Promise<boolean> {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${row.id}, 0))`;
        const current = await tx.scopedOperation.findUnique({ where: { id: row.id } });
        if (!current || rowSchema.parse(current.result).state !== 'pending') return false;
        await tx.scopedOperation.update({ where: { id: row.id }, data: { result: { ...value, state: 'dispatching' } as Prisma.InputJsonValue } });
        return true;
    });
}

/** Only never-attempted pending events are dispatched. A crash during/after
 * external work leaves dispatching/uncertain evidence and is NOT auto-replayed.
 * Accounts are dispatched concurrently; receipts within one account stay ordered. */
export async function drainCriticalEvents(limit: number = EVENT_LIMITS.DRAIN_BATCH_SIZE) {
    z.number().int().min(1).max(EVENT_LIMITS.DRAIN_BATCH_SIZE).parse(limit);
    // Keep these literal predicates aligned with the partial index. Only pending
    // receipts are indexed; completed history must not be scanned on every tick.
    const rows = await prisma.$queryRaw<Array<Pick<ScopedOperation, 'id' | 'accountId' | 'result'>>>`
        SELECT "id", "accountId", "result" FROM "ScopedOperation"
        WHERE "kind" = 'critical-event-outbox' AND "result"->>'state' = 'pending'
        ORDER BY "createdAt" ASC, "id" ASC
        LIMIT ${limit}
    `;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
        const group = groups.get(row.accountId) ?? [];
        group.push(row);
        groups.set(row.accountId, group);
    }
    const accounts = [...groups.values()];
    const errors: unknown[] = [];
    let cursor = 0;
    const run = async () => {
        while (cursor < accounts.length) {
            const group = accounts[cursor++];
            try {
                for (const row of group) {
                    const value = rowSchema.parse(row.result);
                    if (!EventBus.hasRequiredSubscribers(value.event, value.subscribers)) continue;
                    if (!await claimCriticalEvent(row, value)) continue;
                    try {
                        await EventBus.publishRequired(value.event, value.payload);
                        await prisma.scopedOperation.update({ where: { id: row.id }, data: { result: { ...value, state: 'complete' } as Prisma.InputJsonValue } });
                    } catch {
                        await prisma.scopedOperation.updateMany({ where: { id: row.id }, data: { result: { ...value, state: 'uncertain' } as Prisma.InputJsonValue } });
                    }
                }
            } catch (error) {
                // Stop this account on infrastructure/validation failure, leaving
                // unattempted rows pending. Other accounts can still make progress.
                errors.push(error);
            }
        }
    };
    // Observe every worker immediately and wait for all work before allowing the
    // timer's next drain, including when a claim or reconciliation write fails.
    const settled = await Promise.allSettled(Array.from({ length: Math.min(EVENT_LIMITS.DRAIN_ACCOUNT_CONCURRENCY, accounts.length) }, run));
    for (const result of settled) if (result.status === 'rejected') errors.push(result.reason);
    if (errors.length) throw errors[0];
}
