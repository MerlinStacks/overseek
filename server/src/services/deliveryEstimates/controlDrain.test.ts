import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: [] as any[], products: {} as Record<string, number[]>, version: {} as Record<string, number>, network: vi.fn(), bulkCreate: vi.fn(), bulkUpdate: vi.fn(), reads: vi.fn(), sourceValid: true }));
vi.mock('../../utils/prisma', () => {
    const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
        if (key === 'OR') return value.some((v: any) => matches(row, v));
        if (key === 'NOT') return !matches(row, value);
        if (value && typeof value === 'object' && !(value instanceof Date)) {
            if ('in' in value) return value.in.includes(row[key]);
            if ('notIn' in value) return !value.notIn.includes(row[key]);
            if ('lt' in value) return row[key] < value.lt;
            if ('lte' in value) return row[key] != null && row[key] <= value.lte;
            if ('gt' in value) return row[key] != null && row[key] > value.gt;
        }
        return row[key] === value;
    });
    const change = (row: any, data: any) => {
        for (const [key, v] of Object.entries(data) as any) {
            if (v && typeof v === 'object' && 'increment' in v) row[key] += typeof row[key] === 'bigint' ? BigInt(v.increment) : v.increment;
            else if (key === 'controlPayload' && v && !v.action) row[key] = null; // Prisma DbNull
            else row[key] = structuredClone(v);
        }
    };
    const db: any = { $executeRawUnsafe: vi.fn(), receiptAccount: {
        findMany: async ({ where, take }: any) => m.rows.filter(r => matches(r, where)).sort((a, b) => +a.controlNextAttemptAt - +b.controlNextAttemptAt || a.accountId.localeCompare(b.accountId)).slice(0, take).map(r => structuredClone(r)),
        findFirst: async ({ where }: any) => m.rows.find(r => matches(r, where)) ?? null,
        updateMany: async ({ where, data }: any) => { const rows = m.rows.filter(r => matches(r, where)); rows.forEach(r => change(r, data)); return { count: rows.length }; },
    }, receiptOwner: { createMany: m.bulkCreate, updateMany: m.bulkUpdate }, receiptOperation: { count: async () => 0 }, receiptLegacyWork: { count: async () => 0 },
        account: { update: async () => ({}) }, deliverySyncAccount: { upsert: async () => ({}) } };
    db.$transaction = async (fn: any) => fn(db);
    return { prisma: db };
});
vi.mock('./intents', () => ({ lockDeliveryAccount: vi.fn(), dirtyInbound: vi.fn(), configuredInboundProducts: {} }));
vi.mock('./inventoryCompatibility', () => ({ checkInventoryCompatibility: async () => ({ ready: true }) }));
vi.mock('./freshnessPrerequisite', () => ({ checkFreshnessPrerequisite: async () => ({ ready: true }) }));
vi.mock('../woo', () => ({ WooService: { forAccount: async (id: string) => ({ deliveryControl: (input: any, timeout: number) => m.network(id, input, timeout) }) } }));
vi.mock('./cutoverBatch', async original => ({ ...await original<typeof import('./cutoverBatch')>(),
    buildCutoverBatch: async (_tx: unknown, id: string, revision: bigint, epoch: string, cursor: string | null, progress: any) => {
        m.reads(id); const ids = (m.products[id] ?? []).filter(n => n > Number(cursor ?? 0)).slice(0, 50);
        return { schemaVersion: 1, revision: Number(revision), epoch, action: ids.length || !progress.baselineEstablished ? 'baseline' : 'guarded', owners: ids,
            cursor: ids.length ? String(ids.at(-1)) : cursor,
            ...(ids.length || !progress.baselineEstablished ? { page: { version: 1, after: cursor, productIds: ids.map(String), productCount: ids.length, ownerCount: ids.length, sourceHash: String(m.version[id] ?? 0) } } : {}) };
    }, cutoverBatchStillCurrent: async (_tx: unknown, id: string, page: any) => m.sourceValid && page.sourceHash === String(m.version[id] ?? 0),
}));
import { drainDeliveryControls } from './launch';

function enrol(accountId: string, count = 1000, action = 'cutover') {
    const row = { accountId, cutoverEpoch: `epoch-${accountId}`, cutoverState: 'baseline', receivingFrozen: true,
        controlAction: action, controlRevision: 1n, controlAckRevision: 0n, controlPayload: null, controlCursor: null,
        controlAttempts: 0, controlNextAttemptAt: new Date(0), controlLeaseToken: null, controlLeaseExpiresAt: null,
        pluginReadiness: null, active: false, desiredActive: false };
    m.rows.push(row); m.products[accountId] = Array.from({ length: count }, (_, i) => i + 1); return row;
}
const plugin = (id: string) => ({ schemaVersion: 1, protocolVersion: 1, blockers: [], wooVersion: '10.6.2', presentation: 'classic', environmentFingerprint: 'a'.repeat(64), state: { revision: 0, active: false, mode: 'baseline', epoch: `epoch-${id}` } });
const ack = (command: any) => ({ schemaVersion: 1, revision: command.revision, state: { active: false, epoch: command.epoch, mode: command.action === 'baseline' ? 'baseline' : 'guarded' } });
const sent = () => m.network.mock.calls.filter(c => c[1]).map(c => ({ account: c[0], command: c[1] }));
beforeEach(() => {
    vi.clearAllMocks(); m.rows = []; m.products = {}; m.version = {}; m.sourceValid = true;
    m.network.mockImplementation(async (id, command) => command ? ack(command) : plugin(id));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('bounded fair control drain', () => {
    it.each([500, 1000])('finishes %s products in <=40 commands and several pages per tick', async count => {
        const row = enrol('a', count);
        await drainDeliveryControls();
        expect(sent().length).toBe(8); expect(Number(row.controlRevision)).toBe(9);
        for (let i = 0; row.controlAction && i < 4; i++) await drainDeliveryControls();
        expect(row.controlAction).toBeNull(); expect(row.receivingFrozen).toBe(false);
        expect(sent()).toHaveLength(count / 50 + 1);
        expect(row.pluginReadiness.cutoverProgress).toMatchObject({ productsProcessed: count, pagesAcknowledged: count / 50, ownerCertifications: count });
        expect(m.bulkCreate).toHaveBeenCalledTimes(count / 50); expect(m.bulkUpdate).toHaveBeenCalledTimes(count / 50);
    });
    it('prioritizes disables, including new disables arriving between fair account pages', async () => {
        enrol('a'); enrol('b'); enrol('c'); enrol('z', 0, 'disable');
        let injected = false;
        m.network.mockImplementation(async (id, command) => {
            if (command?.action === 'baseline' && !injected) { injected = true; enrol('urgent', 0, 'disable'); }
            return command ? ack(command) : plugin(id);
        });
        await drainDeliveryControls({ maxRounds: 2 });
        expect(sent().slice(0, 5).map(s => s.account)).toEqual(['z', 'a', 'urgent', 'b', 'c']);
        expect(sent().slice(5, 8).map(s => s.account)).toEqual(['a', 'b', 'c']);
    });
    it('replays a lost ACK with the same command, then rewinds an altered source prefix without certifying it', async () => {
        const row = enrol('a', 100);
        m.network.mockImplementationOnce(async id => plugin(id)).mockRejectedValueOnce(new Error('lost ACK'));
        await drainDeliveryControls();
        const reserved = structuredClone(row.controlPayload); expect(row.controlCursor).toBeNull();
        m.version.a = 1; row.controlNextAttemptAt = new Date(0);
        await drainDeliveryControls({ maxRounds: 1 });
        expect(sent()[1].command).toEqual(reserved);
        expect(row.controlCursor).toBeNull(); expect(row.controlRevision).toBe(2n); expect(row.controlPayload).toBeNull();
        expect(m.bulkCreate).not.toHaveBeenCalled();
        await drainDeliveryControls({ maxRounds: 1 });
        expect(row.controlCursor).toBe('50');
        expect(row.pluginReadiness.cutoverProgress).toMatchObject({ productsProcessed: 50, sourceRebuilds: 1 });
    });
    it('bounds repeated source conflict rebuilds and keeps the acknowledged cursor unchanged', async () => {
        const row = enrol('a'); m.sourceValid = false;
        await drainDeliveryControls();
        expect(sent()).toHaveLength(3); expect(row.controlAttempts).toBe(8); expect(row.controlCursor).toBeNull();
        expect(m.bulkCreate).not.toHaveBeenCalled();
    });
    it('stops at the wall budget and supplies bounded remaining time to transport', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T00:00:00Z')); enrol('a');
        m.network.mockImplementation(async (id, command, timeout) => {
            expect(timeout).toBeLessThanOrEqual(8000); expect(timeout).toBeGreaterThan(0);
            if (command) vi.setSystemTime(Date.now() + 4000);
            return command ? ack(command) : plugin(id);
        });
        await drainDeliveryControls(); expect(sent()).toHaveLength(2);
    });
    it('honors a command cap even with more due accounts and fast transports', async () => {
        for (let i = 0; i < 20; i++) enrol(`account-${String(i).padStart(2, '0')}`);
        await drainDeliveryControls({ maxCommands: 7 });
        expect(sent()).toHaveLength(7); expect(new Set(sent().map(s => s.account)).size).toBe(7);
    });
    it('honors a historical command without a page fence, then safely rebuilds from the old cursor', async () => {
        const row = enrol('a', 100);
        row.controlPayload = { schemaVersion: 1, revision: 1, action: 'baseline', epoch: 'epoch-a', owners: [1], cursor: '1' } as any;
        await drainDeliveryControls({ maxRounds: 1 });
        expect(row.controlCursor).toBeNull(); expect(m.reads).not.toHaveBeenCalled();
        await drainDeliveryControls({ maxRounds: 1 }); expect(row.controlCursor).toBe('50');
    });
});
