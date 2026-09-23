import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({ page: vi.fn(), product: vi.fn(), lock: vi.fn(), groups: vi.fn(), latest: vi.fn(),
    controlFind: vi.fn(), controlUpsert: vi.fn(), controlUpdate: vi.fn(), controlScan: vi.fn(), controlMany: vi.fn(),
    inputFind: vi.fn(), inputUpsert: vi.fn(), inputScan: vi.fn(), transaction: vi.fn(), warn: vi.fn() }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: mocks.warn } }));
vi.mock('../../utils/prisma', () => {
    const db = {
        $queryRaw: (sql: TemplateStringsArray, ...args: unknown[]) => sql.join('').includes('COUNT(*)') ? mocks.groups() : mocks.lock(sql, ...args),
        $executeRaw: vi.fn(),
        receiptAccount: { findUnique: async () => null },
        deliverySyncAccount: { findUnique: mocks.controlFind, upsert: mocks.controlUpsert, update: mocks.controlUpdate, findMany: mocks.controlScan, updateMany: mocks.controlMany },
        deliveryInputSync: { findUnique: mocks.inputFind, upsert: mocks.inputUpsert, findMany: mocks.inputScan, groupBy: mocks.groups, findFirst: mocks.latest,
            updateMany: async ({ where, data }: any) => { for (const row of state.rows.values()) if (where.status.in.includes(row.status)) update(row, data); return { count: 1 }; } },
        deliveryInboundDirtyTarget: { findFirst: async () => null, count: async () => 0 },
        wooProduct: { findMany: mocks.page, findFirst: mocks.product },
        account: { findUniqueOrThrow: async () => ({ timezone: 'UTC' }) },
        accountFeature: { findUnique: async () => ({ isEnabled: false }) },
        deliveryEstimateSettings: { findUnique: async () => null },
    };
    return { prisma: { ...db, $transaction: (callback: (tx: unknown) => unknown) => mocks.transaction(callback, db) } };
});
vi.mock('../woo', () => ({ WooService: { forAccount: () => { throw new Error('No network on retry/build'); } } }));
import { requestDeliverySync, deliverySyncStatus } from './sync';
import { buildDeliveryResyncBatch, drainDeliveryResyncs, RESYNC_BATCH_SIZE, RESYNC_MAX_ATTEMPTS, RESYNC_MAX_BACKOFF_MS } from './resync';
import { recordProductIntent, recordSettingsIntent } from './intents';
import { prisma } from '../../utils/prisma';

// Transactional in-memory adapter exercises the real enqueue, builder and intent functions.
// PostgreSQL lock/CAS behavior still requires a live integration environment.
let state: { control: any; rows: Map<string, any>; products: any[] };
const product = (id: number, days: number | null = 2) => ({ id: `p${String(id).padStart(6, '0')}`, wooId: id, accountId: 'a', productionMinDays: days, productionMaxDays: days, variations: [] });
function update(target: any, data: any) {
    for (const [key, value] of Object.entries(data)) target[key] = value === Prisma.DbNull ? null : value && typeof value === 'object' && 'increment' in value ? target[key] + (typeof target[key] === 'bigint' ? BigInt(value.increment as number) : value.increment) : value;
    return structuredClone(target);
}
function key(where: any) { return `${where.scope}:${where.entityId}`; }
function scanDueBuilds() {
    mocks.controlScan.mockImplementation(async ({ where }) => state.control?.resyncRequested && !state.control.buildFailed &&
        state.control.buildNextAttemptAt <= where.buildNextAttemptAt.lte && !where.accountId?.notIn.includes('a') ? [structuredClone(state.control)] : []);
}

describe('durable background resync and truthful status', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.lock.mockResolvedValue([]);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-21T12:00:00Z'));
        state = { control: null, rows: new Map(), products: [] };
        mocks.transaction.mockImplementation(async (callback, db) => {
            const before = structuredClone(state);
            try { return await callback(db); }
            catch (error) { state = before; throw error; }
        });
        mocks.controlFind.mockImplementation(async () => structuredClone(state.control));
        mocks.controlUpsert.mockImplementation(async ({ update: data }) => {
            state.control ??= { accountId: 'a', capabilityStatus: 'unknown', resyncRequested: false, resyncGeneration: 0, resyncCursor: null, resyncPhase: 'products',
                inboundGeneration: 0, inboundVersion: 0, inboundRequested: false,
                buildAttempts: 0, buildNextAttemptAt: new Date(), buildFailed: false, buildLastError: null, buildVersion: 0 };
            return update(state.control, data);
        });
        mocks.controlUpdate.mockImplementation(async ({ data }) => update(state.control, data));
        mocks.controlMany.mockImplementation(async ({ where, data }) => {
            if (!state.control || !Object.entries(where).every(([field, value]) => state.control[field] === value)) return { count: 0 };
            update(state.control, data);
            return { count: 1 };
        });
        mocks.controlScan.mockResolvedValue([]);
        mocks.inputFind.mockImplementation(async ({ where }) => structuredClone(state.rows.get(key(where.accountId_scope_entityId)) ?? null));
        mocks.inputUpsert.mockImplementation(async ({ where, create, update: data }) => {
            const identity = key(where.accountId_scope_entityId);
            let row = state.rows.get(identity);
            if (row) update(row, data);
            else { row = { id: `row${identity}`, desiredRevision: 1n, ackRevision: 0n, status: 'pending', resyncGeneration: 0, ...create }; state.rows.set(identity, row); }
            return structuredClone(row);
        });
        mocks.page.mockImplementation(async ({ where, take }) => state.products.filter(p => p.accountId === where.accountId && (!where.id || p.id > where.id.gt) && (p.productionMinDays !== null || p.variations.some((v: any) => v.productionMinDays !== null))).slice(0, take));
        mocks.product.mockImplementation(async ({ where }) => structuredClone(state.products.find(p => p.accountId === where.accountId && (where.id ? p.id === where.id : p.wooId === where.wooId)) ?? null));
        mocks.inputScan.mockImplementation(async ({ where, take }) => [...state.rows.values()].filter(row => row.scope === 'product' && row.resyncGeneration !== where.resyncGeneration.not && (!where.id || row.id > where.id.gt)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take));
        mocks.groups.mockImplementation(async () => {
            const counts = new Map<string, { scope: string; status: string; total: bigint; acknowledged: bigint }>();
            for (const row of state.rows.values()) {
                const key = `${row.scope}:${row.status}`;
                const count = counts.get(key) ?? { scope: row.scope, status: row.status, total: 0n, acknowledged: 0n };
                count.total++;
                if (row.ackRevision > 0n) count.acknowledged++;
                counts.set(key, count);
            }
            return [...counts.values()];
        });
        mocks.latest.mockImplementation(async ({ where }) => {
            if (where.status?.in) return [...state.rows.values()].find(row => where.status.in.includes(row.status)) ?? null;
            if (where.OR) return [...state.rows.values()].find(row => row.status !== 'synced') ?? null;
            return null;
        });
    });
    afterEach(() => vi.useRealTimers());
    it('enqueues 10,000 products with no catalogue read, row-wide wake or network, and coalesces repeats', async () => {
        state.products = Array.from({ length: 10_000 }, (_, n) => product(n + 1));
        const result = await requestDeliverySync('a');
        expect(result.status).toMatchObject({ configurationSync: 'pending', storefrontActivated: false, pendingCount: 3 });
        expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.product).not.toHaveBeenCalled(); expect(mocks.inputScan).not.toHaveBeenCalled();
        expect(state.rows.size).toBe(1);
        expect(state.rows.get('settings:0').payload.enabled).toBe(false);
        await requestDeliverySync('a');
        expect(state.control.resyncGeneration).toBe(1);
        expect(state.rows.get('settings:0').desiredRevision).toBe(1n);
        expect(mocks.inputUpsert).toHaveBeenCalledTimes(1);
    });
    it('explicit retry clears inbound suppression/failure while preserving its active cursor', async () => {
        await requestDeliverySync('a');
        Object.assign(state.control, { inboundCapabilityStatus: 'plugin_update_required', inboundFailed: true, inboundAttempts: 8, inboundLastError: 'failed', inboundCursor: 'p001', inboundBuildGeneration: 1 });
        await requestDeliverySync('a');
        expect(state.control).toMatchObject({ inboundCapabilityStatus: 'unknown', inboundFailed: false, inboundAttempts: 0, inboundLastError: null, inboundCursor: 'p001', inboundBuildGeneration: 1 });
        expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.inputScan).not.toHaveBeenCalled();
    });
    it('healthy repeats leave every generation, revision and deadline unchanged during builds and transport', async () => {
        await requestDeliverySync('a');
        const before = structuredClone(state);
        expect((await requestDeliverySync('a')).requestDisposition).toBe('already_running');
        expect(state).toEqual(before);
        Object.assign(state.control, { resyncRequested: false, inboundRequested: false, inboundFullRequested: false });
        const delivering = structuredClone(state);
        expect((await requestDeliverySync('a')).requestDisposition).toBe('already_running');
        expect(state).toEqual(delivering);
    });
    it.each(['blocked', 'failed', 'plugin_update_required'])('retries %s transport without a new catalogue wave or revision reset', async status => {
        await requestDeliverySync('a');
        Object.assign(state.control, { resyncRequested: false, inboundRequested: false, inboundFullRequested: false });
        const row = state.rows.get('settings:0');
        Object.assign(row, { status, desiredRevision: 9n, ackRevision: 8n, attempts: 8 });
        expect((await requestDeliverySync('a')).requestDisposition).toBe('retrying');
        expect(row).toMatchObject({ status: 'pending', desiredRevision: 9n, ackRevision: 8n, attempts: 0 });
        expect(state.control).toMatchObject({ resyncRequested: false, inboundRequested: false, resyncGeneration: 1, inboundGeneration: 1 });
    });
    it('coalesces nonterminal transport backoff without expediting its retry deadline', async () => {
        await requestDeliverySync('a');
        const nextAttemptAt = new Date(Date.now() + 120_000);
        Object.assign(state.control, { resyncRequested: false, inboundRequested: false, inboundFullRequested: false, nextAttemptAt });
        Object.assign(state.rows.get('settings:0'), { attempts: 3, lastError: 'Delivery transport unavailable.', nextAttemptAt });
        const before = structuredClone(state);
        expect((await requestDeliverySync('a')).requestDisposition).toBe('already_running');
        expect(state).toEqual(before);
    });
    it('reports per-scope ACK history separately from current pending and parked inputs', async () => {
        await requestDeliverySync('a');
        Object.assign(state.rows.get('settings:0'), { status: 'synced', ackRevision: 1n });
        for (const [scope, status, ackRevision, entityId] of [
            ['product', 'pending', 2n, 1], ['product', 'failed', 0n, 2],
            ['inbound', 'blocked', 3n, 1], ['inbound', 'plugin_update_required', 0n, 2],
        ] as const) state.rows.set(`${scope}:${entityId}`, { scope, status, ackRevision });
        const { status } = await deliverySyncStatus('a');
        expect(status).toMatchObject({ pendingCount: 6, syncedCount: 1, progress: {
            totalInputs: 5, acknowledgedInputs: 3, pendingInputs: 1, blockedInputs: 1, failedInputs: 1, pluginUpdateRequiredInputs: 1,
            dirtyProducts: 0, rebuildingProducts: true, rebuildingInbound: true,
            scopes: [
                { scope: 'settings', total: 1, synced: 1, acknowledged: 1, pending: 0, blocked: 0, failed: 0, pluginUpdateRequired: 0 },
                { scope: 'product', total: 2, synced: 0, acknowledged: 1, pending: 1, blocked: 0, failed: 1, pluginUpdateRequired: 0 },
                { scope: 'inbound', total: 2, synced: 0, acknowledged: 1, pending: 0, blocked: 1, failed: 0, pluginUpdateRequired: 1 },
            ],
        } });
    });
    it('bounds each page, checkpoints atomically, and resumes after a crash without double increment', async () => {
        state.products = Array.from({ length: 60 }, (_, n) => product(n + 1));
        await requestDeliverySync('a');
        await buildDeliveryResyncBatch('a');
        expect(state.control.resyncCursor).toBe(product(RESYNC_BATCH_SIZE).id);
        expect(state.rows.size).toBe(RESYNC_BATCH_SIZE + 1);
        const original = mocks.inputUpsert.getMockImplementation()!;
        let writes = 0;
        mocks.inputUpsert.mockImplementation(async query => { if (++writes === 3) throw new Error('crash'); return original(query); });
        await expect(buildDeliveryResyncBatch('a')).rejects.toThrow('crash');
        expect(state.control.resyncCursor).toBe(product(RESYNC_BATCH_SIZE).id);
        expect(state.rows.size).toBe(RESYNC_BATCH_SIZE + 1);
        mocks.inputUpsert.mockImplementation(original);
        vi.advanceTimersByTime(30_000);
        await buildDeliveryResyncBatch('a');
        expect(mocks.page.mock.calls.at(-1)![0]).toMatchObject({ where: { accountId: 'a', id: { gt: product(RESYNC_BATCH_SIZE).id } }, take: RESYNC_BATCH_SIZE });
        await buildDeliveryResyncBatch('a');
        await buildDeliveryResyncBatch('a');
        expect(state.control.resyncRequested).toBe(false);
        expect(state.rows.size).toBe(61);
        expect([...state.rows.values()].every(row => row.desiredRevision === 1n)).toBe(true);
    });
    it('rebuilds stale rows once, retains deleted-product clears, and never wakes stale payloads before rebuild', async () => {
        state.products = [product(1), product(2, null)];
        await prisma.$transaction(async tx => {
            await recordProductIntent(tx, 'a', product(1, 8));
            await recordProductIntent(tx, 'a', product(2, 8));
            await recordProductIntent(tx, 'a', product(3, null));
        });
        for (const row of state.rows.values()) row.status = 'synced';
        await requestDeliverySync('a');
        expect(state.rows.get('product:1')).toMatchObject({ desiredRevision: 1n, status: 'synced', payload: { productionMinDays: 8 } });
        await buildDeliveryResyncBatch('a');
        expect(state.control.resyncRequested).toBe(true);
        await buildDeliveryResyncBatch('a');
        for (const id of [1, 2, 3]) expect(state.rows.get(`product:${id}`).desiredRevision).toBe(2n);
        expect(state.rows.get('product:1').payload.productionMinDays).toBe(2);
        expect(state.rows.get('product:2').payload.productionMinDays).toBeNull();
        expect(state.rows.get('product:3').payload.productionMinDays).toBeNull();
        expect(state.control.resyncRequested).toBe(false);
    });
    it('normal saves during a build supersede its snapshot and repeated requests retain the cursor', async () => {
        state.products = Array.from({ length: 30 }, (_, n) => product(n + 1));
        await requestDeliverySync('a');
        await buildDeliveryResyncBatch('a');
        const cursor = state.control.resyncCursor;
        await requestDeliverySync('a');
        expect(state.control.resyncCursor).toBe(cursor);
        await prisma.$transaction(tx => recordProductIntent(tx, 'a', product(26, null)));
        await buildDeliveryResyncBatch('a');
        await buildDeliveryResyncBatch('a');
        expect(state.rows.get('product:26')).toMatchObject({ desiredRevision: 1n, payload: { productionMinDays: null } });
        expect((await requestDeliverySync('a')).requestDisposition).toBe('already_running');
        for (const row of state.rows.values()) row.status = 'synced';
        Object.assign(state.control, { inboundRequested: false, inboundFullRequested: false });
        expect((await requestDeliverySync('a')).requestDisposition).toBe('queued');
        expect(state.control).toMatchObject({ resyncGeneration: 2, resyncCursor: null, resyncRequested: true });
    });
    it('reports pending while a build exists even if all materialized rows were acknowledged', async () => {
        await requestDeliverySync('a');
        state.rows.get('settings:0').status = 'synced';
        expect((await deliverySyncStatus('a')).status).toMatchObject({ configurationSync: 'pending', pendingCount: 2, syncedCount: 1 });
    });
    it('does not report product-first sync complete until its seeded settings are acknowledged', async () => {
        await prisma.$transaction(tx => recordProductIntent(tx, 'a', product(1)));
        state.rows.get('product:1').status = 'synced';
        expect((await deliverySyncStatus('a')).status).toMatchObject({ configurationSync: 'pending', pendingCount: 1, syncedCount: 1 });
        state.rows.get('settings:0').status = 'synced';
        expect((await deliverySyncStatus('a')).status).toMatchObject({ configurationSync: 'synced', pendingCount: 0, syncedCount: 2 });
    });
    it('bounds and fairly orders background account selection', async () => {
        await drainDeliveryResyncs(1000);
        expect(mocks.controlScan).toHaveBeenCalledWith(expect.objectContaining({ where: { resyncRequested: true, buildFailed: false, buildNextAttemptAt: { lte: expect.any(Date) } }, orderBy: [{ lastBuildAt: 'asc' }, { accountId: 'asc' }], take: 4 }));
    });
    it('uses spare capacity for a single large account but stops at four pages per drain', async () => {
        state.products = Array.from({ length: 10_000 }, (_, n) => product(n + 1));
        await requestDeliverySync('a');
        mocks.controlScan.mockImplementation(async () => state.control.resyncRequested ? [{ accountId: 'a' }] : []);
        await drainDeliveryResyncs(1000);
        expect(mocks.page).toHaveBeenCalledTimes(4);
        expect(state.rows.size).toBe(101);
        expect(state.control).toMatchObject({ resyncRequested: true, resyncCursor: product(100).id });
        expect(mocks.controlScan.mock.calls.map(([query]) => query.take)).toEqual([4, 3, 2, 1]);
    });
    it('reports unrequested accounts without creating draft data', async () => {
        expect((await deliverySyncStatus('a')).status.configurationSync).toBe('not_requested');
        expect(mocks.controlUpsert).not.toHaveBeenCalled(); expect(mocks.inputUpsert).not.toHaveBeenCalled();
    });
    it('backs off bounded rebuild failures, displays sanitized errors, and excludes terminal builds', async () => {
        await requestDeliverySync('a');
        scanDueBuilds();
        mocks.page.mockRejectedValue(new Error('secret credentials / private product payload'));
        for (let attempt = 1; attempt <= RESYNC_MAX_ATTEMPTS; attempt++) {
            const now = Date.now();
            await drainDeliveryResyncs();
            expect(mocks.page).toHaveBeenCalledTimes(attempt);
            expect(state.control.buildAttempts).toBe(attempt);
            const delay = Math.min(RESYNC_MAX_BACKOFF_MS, 30_000 * 2 ** (attempt - 1));
            expect(state.control.buildNextAttemptAt.getTime()).toBe(now + delay);
            expect(state.control.lastBuildAt.getTime()).toBe(now);
            const status = (await deliverySyncStatus('a')).status;
            expect(status.configurationSync).toBe(attempt === RESYNC_MAX_ATTEMPTS ? 'failed' : 'pending');
            expect(status.lastError).toBe(attempt === RESYNC_MAX_ATTEMPTS ? 'Delivery input rebuild failed. Retry sync to resume.' : 'Delivery input rebuild failed. Retrying automatically.');
            // Both scan and builder recheck the due/terminal state (including stale scan results).
            await drainDeliveryResyncs();
            await buildDeliveryResyncBatch('a');
            expect(mocks.page).toHaveBeenCalledTimes(attempt);
            vi.advanceTimersByTime(delay);
        }
        expect(state.control.buildFailed).toBe(true);
        vi.advanceTimersByTime(86_400_000);
        await drainDeliveryResyncs();
        await buildDeliveryResyncBatch('a');
        expect(mocks.page).toHaveBeenCalledTimes(RESYNC_MAX_ATTEMPTS);
        expect(mocks.warn.mock.calls.every(args => JSON.stringify(args) === JSON.stringify(['Delivery input rebuild failed', { accountId: 'a' }]))).toBe(true);
        const failure = { buildAttempts: state.control.buildAttempts, buildLastError: state.control.buildLastError, buildFailed: true, buildNextAttemptAt: state.control.buildNextAttemptAt };
        await prisma.$transaction(async tx => { await recordProductIntent(tx, 'a', product(1)); await recordSettingsIntent(tx, 'a'); });
        expect(state.control).toMatchObject(failure);
        expect((await deliverySyncStatus('a')).status.configurationSync).toBe('failed');
    });
    it('explicit retry resumes a terminal page without restarting or incrementing entity revisions', async () => {
        state.products = Array.from({ length: 60 }, (_, n) => product(n + 1));
        await requestDeliverySync('a');
        await buildDeliveryResyncBatch('a');
        state.control.buildAttempts = RESYNC_MAX_ATTEMPTS - 1;
        mocks.page.mockRejectedValueOnce(new Error('bad snapshot'));
        await expect(buildDeliveryResyncBatch('a')).rejects.toThrow('bad snapshot');
        expect(state.control.buildFailed).toBe(true);
        const cursor = state.control.resyncCursor;
        const rows = structuredClone(state.rows);
        const generation = state.control.resyncGeneration;
        const result = await requestDeliverySync('a');
        expect(result.status).toMatchObject({ configurationSync: 'pending', lastError: null });
        expect(state.control).toMatchObject({ resyncRequested: true, resyncCursor: cursor, resyncPhase: 'products', resyncGeneration: generation, buildAttempts: 0, buildFailed: false, buildLastError: null });
        expect(state.rows).toEqual(rows);
        await buildDeliveryResyncBatch('a');
        await buildDeliveryResyncBatch('a');
        await buildDeliveryResyncBatch('a');
        expect(state.control.resyncRequested).toBe(false);
        expect(state.rows.size).toBe(61);
        expect([...state.rows.values()].every(row => row.desiredRevision === 1n)).toBe(true);
    });
    it('a successful automatic retry clears the failure state and resets consecutive attempts', async () => {
        await requestDeliverySync('a');
        mocks.page.mockRejectedValueOnce(new Error('transient failure'));
        await expect(buildDeliveryResyncBatch('a')).rejects.toThrow('transient failure');
        expect(state.control.buildAttempts).toBe(1);
        vi.advanceTimersByTime(30_000);
        await buildDeliveryResyncBatch('a');
        expect(state.control).toMatchObject({ buildAttempts: 0, buildFailed: false, buildLastError: null, resyncPhase: 'replay' });
        expect((await deliverySyncStatus('a')).status.lastError).toBeNull();
    });
    it.each(['another worker'] as const)('a stale failure cannot overwrite %s after rollback', async action => {
        state.products = Array.from({ length: 30 }, (_, n) => product(n + 1));
        await requestDeliverySync('a');
        mocks.page.mockRejectedValueOnce(new Error('stale failure'));
        const original = mocks.transaction.getMockImplementation()!;
        let transactions = 0;
        mocks.transaction.mockImplementation(async (callback, db) => {
            if (++transactions === 2) {
                await buildDeliveryResyncBatch('a');
            }
            return original(callback, db);
        });
        await expect(buildDeliveryResyncBatch('a')).rejects.toThrow('stale failure');
        expect(state.control).toMatchObject({ buildAttempts: 0, buildFailed: false, buildLastError: null });
        expect(state.control.resyncCursor).toBe(action === 'another worker' ? product(25).id : null);
    });
    it('records a failure before the page transaction reads its control using the fenced scan checkpoint', async () => {
        await requestDeliverySync('a');
        scanDueBuilds();
        mocks.controlFind.mockRejectedValueOnce(new Error('database read failed'));
        await drainDeliveryResyncs();
        expect(state.control).toMatchObject({ buildAttempts: 1, buildFailed: false, buildLastError: 'Delivery input rebuild failed. Retrying automatically.' });
        expect(mocks.page).not.toHaveBeenCalled();
    });
});
