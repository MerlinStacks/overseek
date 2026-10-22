import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: new Map<string, any>(), available: vi.fn(), publish: vi.fn(), transaction: vi.fn(), count: vi.fn() }));
vi.mock('../utils/prisma', () => {
    const scopedOperation = {
        create: vi.fn(async ({ data }) => { m.rows.set(data.id, structuredClone(data)); return data; }),
        findUnique: vi.fn(async ({ where }) => m.rows.get(where.id) ?? null),
        findMany: vi.fn(async () => [...m.rows.values()].filter(row => row.kind === 'critical-event-outbox' && row.result.state === 'pending')),
        update: vi.fn(async ({ where, data }) => { const row = m.rows.get(where.id); Object.assign(row, structuredClone(data)); return row; }),
        updateMany: vi.fn(async ({ where, data }) => { Object.assign(m.rows.get(where.id), structuredClone(data)); return { count: 1 }; }),
    };
    return { prisma: { scopedOperation, $queryRaw: vi.fn(), $transaction: m.transaction, wooOrder: { count: m.count } } };
});
vi.mock('./events', async () => ({ ...await vi.importActual('./events'), EventBus: { hasRequiredSubscribers: m.available, publishRequired: m.publish } }));
import { prisma } from '../utils/prisma';
import { drainCriticalEvents, recordCriticalEvent, recordOrderLifecycle } from './CriticalEventOutbox';
beforeEach(() => { vi.clearAllMocks(); m.rows.clear(); m.transaction.mockImplementation(fn => fn(prisma)); m.available.mockReturnValue(true); m.publish.mockResolvedValue(undefined); m.count.mockResolvedValue(1); });
it('persists frozen pending work before any consumer runs and replays one exact source occurrence', async () => {
    const payload = { accountId: 'a', artwork: { email: 'synthetic@example.test' } };
    await recordCriticalEvent(prisma as any, 'artwork:approved', payload, 'source-1');
    payload.artwork.email = 'changed@example.test';
    expect([...m.rows.values()][0].result.payload.artwork.email).toBe('synthetic@example.test'); expect(m.publish).not.toHaveBeenCalled();
    await recordCriticalEvent(prisma as any, 'artwork:approved', { accountId: 'a', artwork: { email: 'synthetic@example.test' } }, 'source-1'); expect(m.rows.size).toBe(1);
    await expect(recordCriticalEvent(prisma as any, 'artwork:approved', payload, 'source-1')).rejects.toThrow('conflict');
});
it('requires every named handler before claiming; only never-attempted pending work dispatches', async () => {
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'a', order: { id: 7 } }, 'source');
    m.available.mockReturnValue(false); await drainCriticalEvents(); expect(m.publish).not.toHaveBeenCalled();
    expect([...m.rows.values()][0].result.state).toBe('pending');
    m.available.mockReturnValue(true); await drainCriticalEvents(); await drainCriticalEvents();
    expect(m.publish).toHaveBeenCalledOnce(); expect([...m.rows.values()][0].result.state).toBe('complete');
});
it('retains uncertain payloads for reconciliation without automatic replay or reset', async () => {
    await recordCriticalEvent(prisma as any, 'review:left', { accountId: 'a', review: { id: 9 } }, 'source');
    m.publish.mockRejectedValue(new Error('lost acknowledgement')); await drainCriticalEvents(); await drainCriticalEvents();
    expect(m.publish).toHaveBeenCalledOnce(); expect([...m.rows.values()][0].result).toMatchObject({ state: 'uncertain', payload: { review: { id: 9 } } });
});
it('records order transition work from authoritative prior state, not every repeated sync', async () => {
    const order = { id: 7, status: 'processing', date_created: new Date().toISOString(), billing: { email: 'synthetic@example.test' } };
    await recordOrderLifecycle(prisma as any, 'a', order, 'processing'); expect(m.rows.size).toBe(0);
    await recordOrderLifecycle(prisma as any, 'a', order, 'pending');
    expect([...m.rows.values()].map(row => row.result.event).sort()).toEqual(['order:paid', 'order:status_changed']);
});
