import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), find: vi.fn(), upsert: vi.fn(), update: vi.fn(), many: vi.fn(), scan: vi.fn(), page: vi.fn(), replay: vi.fn(), intent: vi.fn(), stamp: vi.fn(), build: vi.fn(), lock: vi.fn(), targets: vi.fn(), targetFirst: vi.fn(), targetDelete: vi.fn() }));
vi.mock('../../utils/prisma', () => {
    const db = { $queryRaw: mocks.lock, deliverySyncAccount: { findUnique: mocks.find, upsert: mocks.upsert, update: mocks.update, updateMany: mocks.many, findMany: mocks.scan }, wooProduct: { findMany: mocks.page, findFirst: vi.fn().mockResolvedValue(null) }, deliveryInputSync: { findMany: mocks.replay, update: mocks.stamp }, deliveryInboundDirtyTarget: { findMany: mocks.targets, findFirst: mocks.targetFirst, deleteMany: mocks.targetDelete } };
    return { prisma: { ...db, $transaction: (callback: any) => mocks.transaction(callback, db) } };
});
vi.mock('./inbound', () => ({ buildInbound: mocks.build }));
vi.mock('./intents', async importOriginal => ({ ...await importOriginal<typeof import('./intents')>(), ensureSettingsIntent: vi.fn(), recordIntent: mocks.intent, recordProductIntent: vi.fn() }));
vi.mock('./inboundRenewal', () => ({ renewInboundInputs: vi.fn(), wakeInboundTargets: vi.fn() }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
import { buildInboundBatch, drainInboundBuilds, INBOUND_PAGE_SIZE } from './inboundResync';
import { dirtyInbound } from './intents';
import { prisma } from '../../utils/prisma';

let state: { control: any; products: { id: string; wooId: number; configured?: boolean }[]; rows: Map<number, any>; targets: Map<number, number> };
const patch = (data: any) => { for (const [key, value] of Object.entries(data)) state.control[key] = value && typeof value === 'object' && 'increment' in value ? state.control[key] + value.increment : value; return structuredClone(state.control); };
describe('durable bounded inbound rebuild', () => {
    beforeEach(() => {
        vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T12:00:00Z'));
        state = { control: { accountId: 'a', inboundRequested: false, inboundFullRequested: false, inboundGeneration: 0, inboundBuildGeneration: 0, inboundPhase: 'products', inboundCursor: null, inboundFailed: false, inboundAttempts: 0, inboundVersion: 0, inboundNextAttemptAt: new Date() }, products: [], rows: new Map(), targets: new Map() };
        mocks.transaction.mockImplementation(async (callback, db) => { const before = structuredClone(state); try { return await callback(db); } catch (error) { state = before; throw error; } });
        mocks.find.mockImplementation(async () => structuredClone(state.control));
        mocks.upsert.mockImplementation(async ({ update }) => patch(update));
        mocks.update.mockImplementation(async ({ data }) => patch(data));
        mocks.many.mockImplementation(async ({ where, data }) => { if (!Object.entries(where).every(([key, value]) => state.control[key] === value)) return { count: 0 }; patch(data); return { count: 1 }; });
        mocks.page.mockImplementation(async ({ where, take }) => state.products.filter(p => (!where.OR || p.configured !== false) && (!where.id || p.id > where.id.gt)).slice(0, take));
        mocks.targets.mockImplementation(async ({ take }) => [...state.targets].slice(0, take).map(([wooId, version]) => ({ wooId, version })));
        mocks.targetFirst.mockImplementation(async () => state.targets.size ? { wooId: [...state.targets.keys()][0] } : null);
        mocks.targetDelete.mockImplementation(async ({ where }) => { if (state.targets.get(where.wooId) !== where.version) return { count: 0 }; state.targets.delete(where.wooId); return { count: 1 }; });
        mocks.replay.mockImplementation(async ({ where, take }) => [...state.rows.values()].filter(row => row.inboundGeneration !== where.inboundGeneration.not && (!where.id || row.id > where.id.gt)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take));
        mocks.intent.mockImplementation(async (_tx, _a, _scope, wooId, payload) => state.rows.set(wooId, { id: `r${wooId}`, entityId: wooId, payload, revision: (state.rows.get(wooId)?.revision ?? 0) + 1 }));
        mocks.stamp.mockImplementation(async ({ where, data }) => Object.assign(state.rows.get(where.accountId_scope_entityId.entityId), data));
        mocks.build.mockImplementation(async (_tx, _a, wooId) => ({ wooId, receiptSafety: 'unverified', targets: state.products.some(p => p.wooId === wooId) ? [{ wooId, batches: [] }] : [] }));
        mocks.scan.mockImplementation(async ({ where }) => state.control.inboundRequested && !state.control.inboundFailed && state.control.inboundNextAttemptAt <= where.inboundNextAttemptAt.lte ? [structuredClone(state.control)] : []);
    });
    afterEach(() => vi.useRealTimers());
    const dirty = () => prisma.$transaction(tx => dirtyInbound(tx, 'a'));
    it('does constant work on invalidation and caps a drain at four ten-product pages', async () => {
        state.products = Array.from({ length: 10_000 }, (_, n) => ({ id: String(n).padStart(6, '0'), wooId: n + 1 }));
        await dirty(); await dirty();
        expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
        await drainInboundBuilds(1000);
        expect(mocks.page).toHaveBeenCalledTimes(4); expect(state.rows.size).toBe(4 * INBOUND_PAGE_SIZE);
        expect(mocks.page.mock.calls.every(([query]) => query.take === 10 && query.where.accountId === 'a')).toBe(true);
    });
    it('retains the running cursor and repeats after dirtying old/new sources, including tombstones', async () => {
        state.products = Array.from({ length: 11 }, (_, n) => ({ id: String(n).padStart(6, '0'), wooId: n + 1 }));
        state.rows.set(99, { id: 'r99', entityId: 99, inboundGeneration: 0, revision: 1, payload: { targets: ['stale'] } });
        await dirty(); await buildInboundBatch('a');
        const cursor = state.control.inboundCursor;
        state.products.shift(); await dirty();
        expect(state.control.inboundCursor).toBe(cursor);
        await buildInboundBatch('a'); await buildInboundBatch('a');
        expect(state.control).toMatchObject({ inboundRequested: true, inboundCursor: null, inboundBuildGeneration: 0 });
        expect(state.rows.get(99).payload.targets).toEqual([]);
        await buildInboundBatch('a'); await buildInboundBatch('a'); await buildInboundBatch('a');
        expect(state.control.inboundRequested).toBe(false);
        expect(state.rows.get(1).payload.targets).toEqual([]);
        expect(state.rows.get(11).payload.receiptSafety).toBe('unverified');
    });
    it('rolls back outboxes and cursor together and caps sanitized retry failures', async () => {
        state.products = [{ id: '1', wooId: 1 }, { id: '2', wooId: 2 }]; await dirty();
        const build = mocks.build.getMockImplementation()!;
        mocks.build.mockImplementation(async (...args) => { if (args[2] === 2) throw new Error('secret'); return build(...args); });
        for (let attempt = 1; attempt <= 8; attempt++) {
            await expect(buildInboundBatch('a')).rejects.toThrow('secret');
            expect(state.rows.size).toBe(0); expect(state.control.inboundCursor).toBeNull();
            expect(state.control.inboundAttempts).toBe(attempt); expect(state.control.inboundLastError).not.toContain('secret');
            vi.setSystemTime(state.control.inboundNextAttemptAt);
        }
        expect(state.control.inboundFailed).toBe(true);
        const calls = mocks.build.mock.calls.length; await drainInboundBuilds(); expect(mocks.build).toHaveBeenCalledTimes(calls);
    });
    it('fences failure recovery against a newer successful page or explicit retry', async () => {
        await dirty();
        mocks.transaction.mockImplementationOnce(async () => { state.control.inboundVersion++; throw new Error('transaction unavailable'); });
        await expect(buildInboundBatch('a', { inboundVersion: 0, inboundAttempts: 7 })).rejects.toThrow();
        expect(state.control.inboundFailed).toBe(false); expect(state.control.inboundAttempts).toBe(0);
    });
    it('manual/supplier full builds enrol configured products only and replay old rows for clears', async () => {
        state.products = [{ id: '1', wooId: 1, configured: true }, ...Array.from({ length: 10_000 }, (_, n) => ({ id: `u${n}`, wooId: n + 2, configured: false }))];
        state.rows.set(50_000, { id: 'old', entityId: 50_000, inboundGeneration: 0, revision: 2 });
        await dirty(); await drainInboundBuilds();
        expect([...state.rows.keys()]).toEqual([50_000, 1]);
        expect(state.rows.get(50_000).payload.targets).toEqual([]);
        expect(mocks.page.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([{ productionMinDays: { not: null } }, { variations: { some: { OR: [{ productionMinDays: { not: null } }, { productionMaxDays: { not: null } }] } } }]));
    });
    it('processes only dirty targets in bounded batches without scanning or revising unrelated products', async () => {
        state.products = Array.from({ length: 10_000 }, (_, n) => ({ id: `${n}`, wooId: n + 1 }));
        state.control.inboundRequested = true;
        state.targets = new Map(Array.from({ length: 11 }, (_, n) => [n + 1, 3]));
        state.rows.set(9999, { revision: 7, payload: { old: true } });
        await buildInboundBatch('a');
        expect(mocks.build).toHaveBeenCalledTimes(10); expect(state.targets.size).toBe(1);
        expect(state.control.inboundRequested).toBe(true);
        await buildInboundBatch('a');
        expect(state.control.inboundRequested).toBe(false);
        expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.replay).not.toHaveBeenCalled();
        expect(state.rows.get(9999)).toEqual({ revision: 7, payload: { old: true } });
    });
    it('reserves a bounded full-pass page under a continuous dirty-owner stream', async () => {
        state.products = Array.from({ length: 25 }, (_, n) => ({ id: String(n).padStart(6, '0'), wooId: n + 1 }));
        await dirty();
        for (let page = 0; page < 4; page++) {
            state.targets.set(999, page + 1);
            const before = mocks.build.mock.calls.length;
            await buildInboundBatch('a');
            expect(mocks.build.mock.calls.length - before).toBeLessThanOrEqual(2 * INBOUND_PAGE_SIZE);
        }
        expect(state.control.inboundFullRequested).toBe(false);
        for (let wooId = 1; wooId <= 25; wooId++) expect(state.rows.get(wooId)).toMatchObject({ inboundGeneration: 1 });
    });
    it('stamps current source snapshots with the latest generation while an older pass finishes', async () => {
        Object.assign(state.control, { inboundRequested: true, inboundFullRequested: true, inboundGeneration: 2, inboundBuildGeneration: 1 });
        state.targets.set(999, 1);
        state.products = [{ id: '1', wooId: 1 }];
        await buildInboundBatch('a');
        expect(state.rows.get(999).inboundGeneration).toBe(2);
        expect(state.rows.get(1).inboundGeneration).toBe(2);
    });
    it('CAS retains a re-dirtied target and rollback retains its durable work', async () => {
        state.control.inboundRequested = true; state.targets.set(10, 1);
        mocks.build.mockImplementationOnce(async () => { state.targets.set(10, 2); return { wooId: 10, targets: [] }; });
        await buildInboundBatch('a');
        expect(state.targets.get(10)).toBe(2); expect(state.control.inboundRequested).toBe(true);
        mocks.build.mockRejectedValueOnce(new Error('build failed'));
        await expect(buildInboundBatch('a')).rejects.toThrow('build failed');
        expect(state.targets.get(10)).toBe(2); expect(state.rows.get(10).revision).toBe(1);
        vi.setSystemTime(state.control.inboundNextAttemptAt);
        await buildInboundBatch('a');
        expect(state.targets.size).toBe(0); expect(state.rows.get(10).revision).toBe(2);
    });
});
