import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: new Map<string, any>(), available: vi.fn(), publish: vi.fn(), transaction: vi.fn(), count: vi.fn(), raw: vi.fn() }));
vi.mock('../utils/prisma', () => {
    const scopedOperation = {
        create: vi.fn(async ({ data }) => { m.rows.set(data.id, structuredClone(data)); return data; }),
        findUnique: vi.fn(async ({ where }) => m.rows.get(where.id) ?? null),
        findMany: vi.fn(async () => [...m.rows.values()].filter(row => row.kind === 'critical-event-outbox' && row.result.state === 'pending')),
        update: vi.fn(async ({ where, data }) => { const row = m.rows.get(where.id); Object.assign(row, structuredClone(data)); return row; }),
        updateMany: vi.fn(async ({ where, data }) => { Object.assign(m.rows.get(where.id), structuredClone(data)); return { count: 1 }; }),
    };
    return { prisma: { scopedOperation, $queryRaw: m.raw, $transaction: m.transaction, wooOrder: { count: m.count } } };
});
vi.mock('./events', async () => ({ ...await vi.importActual('./events'), EventBus: { hasRequiredSubscribers: m.available, publishRequired: m.publish } }));
import { prisma } from '../utils/prisma';
import { drainCriticalEvents, recordCriticalEvent, recordOrderLifecycle } from './CriticalEventOutbox';
beforeEach(() => {
    vi.clearAllMocks(); m.rows.clear(); m.transaction.mockImplementation(fn => fn(prisma)); m.available.mockReturnValue(true); m.publish.mockResolvedValue(undefined); m.count.mockResolvedValue(1);
    m.raw.mockImplementation(async (query: TemplateStringsArray, ...values: unknown[]) => {
        if (!query.join('').includes('FROM "ScopedOperation"')) return [];
        return [...m.rows.values()].filter(row => row.kind === 'critical-event-outbox' && row.result.state === 'pending').slice(0, Number(values[0])).map(row => structuredClone(row));
    });
});
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
it('dispatches accounts concurrently while one account keeps its receipt order', async () => {
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'a', order: { id: 1 } }, 'source-a1');
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'b', order: { id: 2 } }, 'source-b1');
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'a', order: { id: 3 } }, 'source-a2');
    const seen: string[] = [];
    let inFlight = 0;
    let peak = 0;
    m.publish.mockImplementation(async (_event: string, payload: any) => {
        peak = Math.max(peak, ++inFlight);
        seen.push(String(payload.order.id));
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight--;
    });
    await drainCriticalEvents();
    expect(peak).toBeGreaterThan(1);
    expect(seen.filter(id => id === '1' || id === '3')).toEqual(['1', '3']);
    expect([...m.rows.values()].map(row => row.result.state)).toEqual(['complete', 'complete', 'complete']);
});
it('records order transition work from authoritative prior state, not every repeated sync', async () => {
    const order = { id: 7, status: 'processing', date_created: new Date().toISOString(), billing: { email: 'synthetic@example.test' } };
    await recordOrderLifecycle(prisma as any, 'a', order, 'processing'); expect(m.rows.size).toBe(0);
    await recordOrderLifecycle(prisma as any, 'a', order, 'pending');
    expect([...m.rows.values()].map(row => row.result.event).sort()).toEqual(['order:paid', 'order:status_changed']);
});

it('does not reserve all worker slots for queued rows belonging to one blocked account', async () => {
    for (let i = 0; i < 6; i++) await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'a', order: { id: i } }, `a-${i}`);
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'b', order: { id: 7 } }, 'b');
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const seen: string[] = [];
    m.publish.mockImplementation(async (_event, payload) => { seen.push(payload.accountId); if (payload.accountId === 'a') await blocked; });
    const drain = drainCriticalEvents();
    try {
        await vi.waitFor(() => expect(seen).toContain('b'));
        expect(seen.filter(id => id === 'a')).toHaveLength(1);
    } finally { release(); await drain; }
});

it('settles a failed claim without leaking slots or leaving rejected promises unobserved', async () => {
    for (let i = 0; i < 6; i++) await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'a', order: { id: i } }, `a-${i}`);
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'b', order: { id: 7 } }, 'b');
    m.transaction.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(drainCriticalEvents()).rejects.toThrow('database unavailable');
    expect(m.publish).toHaveBeenCalledOnce();
    expect(m.publish.mock.calls[0][1].accountId).toBe('b');
    expect([...m.rows.values()].filter(row => row.accountId === 'a').every(row => row.result.state === 'pending')).toBe(true);
});

it('waits for other active accounts before surfacing an infrastructure failure', async () => {
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'a', order: { id: 1 } }, 'a');
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'b', order: { id: 2 } }, 'b');
    m.transaction.mockRejectedValueOnce(new Error('claim failed'));
    let release!: () => void;
    m.publish.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    let finished = false;
    const drain = drainCriticalEvents().then(() => { finished = true; }, error => { finished = true; return error; });
    await vi.waitFor(() => expect(m.publish).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    release();
    expect(await drain).toMatchObject({ message: 'claim failed' });
});

it('bounds active accounts and frees workers for subsequent account groups', async () => {
    for (let i = 0; i < 6; i++) await recordCriticalEvent(prisma as any, 'order:paid', { accountId: `account-${i}`, order: { id: i } }, `source-${i}`);
    const releases: Array<() => void> = [];
    let active = 0, peak = 0;
    m.publish.mockImplementation(async () => {
        peak = Math.max(peak, ++active);
        await new Promise<void>(resolve => releases.push(resolve));
        active--;
    });
    const drain = drainCriticalEvents();
    await vi.waitFor(() => expect(m.publish).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach(release => release());
    await vi.waitFor(() => expect(m.publish).toHaveBeenCalledTimes(6));
    releases.splice(0).forEach(release => release());
    await drain;
    expect(peak).toBe(4);
    expect([...m.rows.values()].every(row => row.result.state === 'complete')).toBe(true);
});

it('surfaces failed reconciliation writes without replaying attempted work', async () => {
    await recordCriticalEvent(prisma as any, 'order:paid', { accountId: 'a', order: { id: 1 } }, 'a');
    m.publish.mockRejectedValueOnce(new Error('delivery uncertain'));
    vi.mocked(prisma.scopedOperation.updateMany).mockRejectedValueOnce(new Error('write unavailable'));
    await expect(drainCriticalEvents()).rejects.toThrow('write unavailable');
    await drainCriticalEvents();
    expect(m.publish).toHaveBeenCalledOnce();
    expect([...m.rows.values()][0].result.state).toBe('dispatching');
});

it('uses bounded pending-only SQL matching the partial index with stable ordering', async () => {
    await drainCriticalEvents(3);
    const [sql, limit] = vi.mocked(prisma.$queryRaw).mock.calls[0];
    const text = (sql as unknown as string[]).join('');
    expect(text).toContain('"kind" = \'critical-event-outbox\' AND "result"->>\'state\' = \'pending\'');
    expect(text).toContain('ORDER BY "createdAt" ASC, "id" ASC');
    expect(limit).toBe(3);
});
