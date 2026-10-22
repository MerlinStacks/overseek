import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { createHash } from 'crypto';
import { z } from 'zod';

// Event Types
export const EVENTS = {
    ORDER: {
        SYNCED: 'order:synced',
        CREATED: 'order:created',
        PAID: 'order:paid',
        COMPLETED: 'order:completed',
        FIRST: 'order:first',
        STATUS_CHANGED: 'order:status_changed',
    },
    SHIPMENT: {
        RECEIVED_BY_CARRIER: 'shipment:received_by_carrier',
        IN_TRANSIT: 'shipment:in_transit',
        OUT_FOR_DELIVERY: 'shipment:out_for_delivery',
        DELIVERY_ATTEMPTED: 'shipment:delivery_attempted',
        DELIVERED: 'shipment:delivered',
        EXCEPTION: 'shipment:exception',
    },
    ARTWORK: {
        UPLOADED: 'artwork:uploaded',
        APPROVAL_REQUESTED: 'artwork:approval_requested',
        APPROVED: 'artwork:approved',
        CHANGES_REQUESTED: 'artwork:changes_requested',
        OVERRIDE_USED: 'artwork:override_used',
    },
    CUSTOMER: {
        CREATED: 'customer:created',
        UPDATED: 'customer:updated',
    },
    PRODUCT: {
        SYNCED: 'product:synced',
    },
    REVIEW: {
        SYNCED: 'review:synced',
        LEFT: 'review:left',
    },
    EMAIL: {
        RECEIVED: 'email:received'
    },
    CHAT: {
        MESSAGE_RECEIVED: 'chat:message_received',
    },
    STOCK: {
        MISMATCH: 'stock:mismatch',
    },
    SOCIAL: {
        MESSAGE_RECEIVED: 'social:message_received',
        MESSAGE_SENT: 'social:message_sent',
        ACCOUNT_CONNECTED: 'social:account_connected',
        ACCOUNT_DISCONNECTED: 'social:account_disconnected',
    },
    AD: {
        ALERT: 'ad:alert', // AI Marketing Intelligence Phase 6
        AUTH_EXPIRED: 'ad:auth_expired', // Token expired, user must reconnect
    },
    INVENTORY: {
        STOCKOUT_ALERT: 'inventory:stockout_alert', // Predictive Inventory Forecasting
    },
    SYNC: {
        FAILURE_THRESHOLD: 'sync:failure_threshold'
    },
    SEO: {
        RANK_CHANGE: 'seo:rank_change',
        KEYWORD_ALERT: 'seo:keyword_alert',
        COMPETITOR_RANK_CHANGE: 'seo:competitor_rank_change',
    }
};

const names = new Set(Object.values(EVENTS).flatMap(group => Object.values(group)));
const envelopeSchema = z.object({ accountId: z.string().min(1).max(200), occurrenceId: z.string().min(1).max(200) }).passthrough();

export class SystemEventBus extends EventEmitter {
    private required = new Map<string, Map<string, (payload: unknown) => Promise<void>>>();
    hasRequiredSubscribers(event: string, subscribers: string[]) { return subscribers.every(id => this.required.get(event)?.has(id)); }
    removeAllListeners(event?: string | symbol): this {
        if (event === undefined) this.required.clear();
        else if (typeof event === 'string') this.required.delete(event);
        return super.removeAllListeners(event);
    }
    constructor() {
        super();
        this.on('error', () => {
            Logger.error('EventBus subscriber failed');
        });
    }

    /** Legacy best-effort observations only. Boolean means listener presence,
     * NEVER committed delivery. Critical consumers use subscribeRequired below. */
    emit(event: string, ...args: any[]): boolean {
        // Why no args: serializing full event payloads (orders, products) on
        // every emit caused significant GC pressure from repeated JSON.stringify.
        if (event !== 'error' && (!names.has(event) || args.length !== 1 || !args[0] || typeof args[0].accountId !== 'string' || !args[0].accountId || args[0].accountId.length > 200)) return false;
        const listeners = this.rawListeners(event);
        for (const listener of listeners) {
            try {
                const result = listener.apply(this, args);
                if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => { Logger.error('EventBus async subscriber failed', { event }); });
            } catch { Logger.error('EventBus synchronous subscriber failed', { event }); }
        }
        return listeners.length > 0;
    }

    /** Required work is admitted once per stable producer occurrence/subscriber.
     * Pending/uncertain receipts are never retried automatically. Producers must
     * persist the occurrence with their state change; emit is only a wake-up. */
    subscribeRequired(event: string, subscriberId: string, handler: (payload: any) => Promise<unknown>): () => void {
        if (!names.has(event) || !/^[a-zA-Z0-9:_-]{1,100}$/.test(subscriberId)) throw new Error('Invalid event subscription');
        const group = this.required.get(event) ?? new Map();
        if (group.has(subscriberId)) throw new Error('Duplicate required subscriber identity');
        this.required.set(event, group);
        const listener = async (input: unknown) => {
            const payload = envelopeSchema.parse(input);
            const id = `event-delivery:${createHash('sha256').update(JSON.stringify([payload.accountId, event, payload.occurrenceId, subscriberId])).digest('hex')}`;
            const admitted = await prisma.$transaction(async tx => {
                await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
                const previous = await tx.scopedOperation.findUnique({ where: { id } });
                if (previous) {
                    if ((previous.result as any).state !== 'complete') throw new Error('Required subscriber pending/uncertain; reconciliation required');
                    return false;
                }
                await tx.scopedOperation.create({ data: { id, accountId: payload.accountId, kind: 'event-delivery', result: { event, subscriberId, occurrenceId: payload.occurrenceId, state: 'dispatching' } } });
                return true;
            });
            if (!admitted) return;
            try {
                const result = await handler(payload);
                const outcome = z.object({ state: z.literal('skipped'), reason: z.string().max(200) }).safeParse(result);
                await prisma.scopedOperation.update({ where: { id }, data: { result: { event, subscriberId, occurrenceId: payload.occurrenceId, state: 'complete', ...(outcome.success ? { outcome: outcome.data } : {}) } } });
            } catch {
                await prisma.scopedOperation.updateMany({ where: { id }, data: { result: { event, subscriberId, occurrenceId: payload.occurrenceId, state: 'uncertain' } } }).catch(() => undefined);
                throw new Error('Required subscriber outcome uncertain; reconcile receipt');
            }
        };
        group.set(subscriberId, listener);
        return () => { if (group.get(subscriberId) === listener) group.delete(subscriberId); };
    }

    /** Durable before-dispatch admission for a stable source occurrence. A source
     * must not acknowledge/delete upstream work until this resolves. Complete
     * means required handlers acknowledged, not downstream customer delivery. */
    async publishRequired(event: string, input: unknown): Promise<void> {
        const payload = envelopeSchema.parse(input);
        if (!names.has(event)) throw new Error('Unknown event');
        const serialized = JSON.stringify(payload);
        if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('Event exceeds bounded payload');
        // A trusted source digest excludes regenerated local attachment URLs on
        // IMAP replay. It is never taken from a public emit/HTTP acknowledgement.
        const digest = payload.sourceDigest === undefined ? createHash('sha256').update(serialized).digest('hex') : z.string().regex(/^[a-f0-9]{64}$/).parse(payload.sourceDigest);
        const id = `event-occurrence:${createHash('sha256').update(JSON.stringify([payload.accountId, event, payload.occurrenceId])).digest('hex')}`;
        const state = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
            const previous = await tx.scopedOperation.findUnique({ where: { id } });
            if (previous) {
                const value = previous.result as any;
                if (value.digest !== digest || value.state !== 'complete') throw new Error('Event pending/uncertain; reconcile original occurrence');
                return 'complete';
            }
            await tx.scopedOperation.create({ data: { id, accountId: payload.accountId, kind: 'event-occurrence', result: { event, digest, state: 'pending', payload: JSON.parse(serialized) } } });
            return 'pending';
        });
        if (state === 'complete') return;
        try {
            const handlers = [...(this.required.get(event)?.values() ?? [])];
            if (!handlers.length) throw new Error('Required event subscriber unavailable');
            for (const handler of handlers) await handler(payload);
            await prisma.scopedOperation.update({ where: { id }, data: { result: { event, digest, state: 'complete' } } });
            this.emit(event, payload);
        } catch {
            await prisma.scopedOperation.updateMany({ where: { id }, data: { result: { event, digest, state: 'uncertain', payload: JSON.parse(serialized) } } }).catch(() => undefined);
            throw new Error('Required event acknowledgement unavailable; reconcile durable occurrence');
        }
    }
}

export const EventBus = new SystemEventBus();
