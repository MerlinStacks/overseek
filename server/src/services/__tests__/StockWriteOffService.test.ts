import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const m = vi.hoisted(() => ({ db: {} as any, state: {} as any, sql: [] as string[] }));
vi.mock('../../utils/prisma', () => ({ prisma: m.db }));
import { deleteWriteOff, finalizeWriteOff, getWriteOff, listWriteOffs, saveWriteOff, writeOffBodySchema, writeOffProducts, writeOffQuerySchema, writeOffUnitCost, writeOffWhere } from '../StockWriteOffService';

beforeEach(() => {
    m.sql = [];
    m.state = { stock: 10, mode: 'GUARDED', frozen: false, cogs: '2.25', costs: [{ amount: 0.1 }, { amount: '0.2' }], audit: [], ops: [], sequence: 0n,
        doc: { id: 'wo', accountId: 'a', reference: 'WO-test', status: 'DRAFT', reason: 'DAMAGED', totalCost: '0', items: [
            { id: 'line', productId: 'p', variationId: null, internalProductId: null, quantity: 2, name: 'Old name', sku: 'old', type: 'PRODUCT', unitCostOverride: null, unitCost: '0', totalCost: '0', cascadeState: 'none' },
        ] } };
    const product = () => ({ id: 'p', accountId: 'a', wooId: 10, name: 'Current product', sku: 'sku', manageStock: true, rawData: { id: 10, type: m.state.variable ? 'variable' : 'simple', manage_stock: true, variations: [11, 12] }, boms: m.state.boms ?? [], stockQuantity: m.state.stock, cogs: m.state.cogs == null ? null : new Prisma.Decimal(m.state.cogs), miscCosts: m.state.costs });
    const variation = (wooId: number) => ({ id: `v${wooId}`, productId: 'p', wooId, sku: `sku-${wooId}`, manageStock: !m.state.inherited, rawData: { id: wooId, parent_id: 10, manage_stock: m.state.inherited ? 'parent' : true }, stockQuantity: m.state.stock, cogs: m.state.variantCogs === null ? null : new Prisma.Decimal(m.state.variantCogs ?? 1), miscCosts: m.state.variantCosts ?? [] });
    Object.assign(m.db, {
        $transaction: async (fn: any) => { const before = structuredClone(m.state); try { return await fn(m.db); } catch (e) { m.state = before; throw e; } },
        $queryRaw: vi.fn(async (parts: TemplateStringsArray, ...args: any[]) => {
            const sql = parts.join('?'); m.sql.push(sql);
            if (sql.includes('SELECT "receiptTransportMode"')) return [{ receiptTransportMode: m.state.mode }];
            if (sql.includes('FOR UPDATE') && !sql.includes('"Account"')) return m.state.missingLock ? [] : [{ id: 'locked' }];
            if (sql.startsWith('UPDATE')) {
                expect(sql).toContain('"stockQuantity">='); expect(sql).not.toContain('COALESCE');
                const internal = sql.includes('"InternalProduct"');
                const quantity = internal ? args[0] : -args[1];
                if (m.state.stock == null || m.state.stock < quantity) return [];
                if (!internal && args[0] !== null) m.state.stock = Math.min(m.state.stock, args[0]);
                m.state.stock -= quantity; return [{ stock: m.state.stock }];
            }
            return [];
        }),
        wooProduct: { findMany: vi.fn(async () => [product()]), findFirst: vi.fn(async ({ where }: any) => where.accountId === 'a' && where.id === 'p' ? product() : null), findFirstOrThrow: vi.fn(async () => product()) },
        internalProduct: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => product()) },
        productVariation: { findMany: vi.fn(async () => []), findUnique: vi.fn(async ({ where }: any) => variation(where.productId_wooId.wooId)), findUniqueOrThrow: vi.fn(async ({ where }: any) => variation(where.productId_wooId.wooId)) },
        bOMItem: { count: vi.fn(async () => 0) }, bOM: { findFirst: vi.fn(async () => null) },
        receiptAccount: { findUnique: vi.fn(async () => ({ receivingFrozen: m.state.frozen, capability: m.state.capability ?? 'supported' })), upsert: vi.fn() },
        receiptOwner: { upsert: vi.fn(async () => ({ lastSequence: ++m.state.sequence })) },
        receiptCycle: { upsert: vi.fn(async ({ create }: any) => create) },
        receiptOperation: {
            findMany: vi.fn(async () => m.state.ops), findUnique: vi.fn(async () => null),
            findFirst: vi.fn(async ({ where, orderBy }: any) => m.state.ops.filter((op: any) => op.accountId === where.accountId && op.stockOwnerWooId === where.stockOwnerWooId && (!where.state || (where.state.in ? where.state.in.includes(op.state) : !where.state.notIn.includes(op.state))) && (!where.sourceType || op.sourceType === where.sourceType) && (!where.sequence || op.sequence > where.sequence.gt)).sort((a: any, b: any) => (a.sequence < b.sequence ? -1 : 1) * (orderBy.sequence === 'asc' ? 1 : -1))[0] ?? null),
            aggregate: vi.fn(async ({ where }: any) => ({ _sum: { delta: m.state.ops.filter((op: any) => op.accountId === where.accountId && op.stockOwnerWooId === where.stockOwnerWooId && op.sequence > where.sequence.gt).reduce((sum: number, op: any) => sum + op.delta, 0) } })),
            create: vi.fn(async ({ data }: any) => { const op = { ...data, state: 'pending' }; m.state.ops.push(op); return op; }),
        },
        stockWriteOff: {
            findFirst: vi.fn(async ({ where }: any) => where.accountId === m.state.doc.accountId && where.id === 'wo' ? m.state.doc : null),
            update: vi.fn(async ({ data }: any) => { if (m.state.failCommit) throw new Error('commit failed'); Object.assign(m.state.doc, data, data.totalCost ? { totalCost: data.totalCost.toString() } : {}); return m.state.doc; }),
            delete: vi.fn(), count: vi.fn(async () => 1), findMany: vi.fn(async () => [{ id: 'wo' }]),
        },
        stockWriteOffItem: {
            findFirst: vi.fn(async ({ where }: any) => [...m.state.doc.items, ...(m.state.previousItems ?? [])].find((i: any) => i.id === where.id && i.operationId === where.operationId) ?? null),
            update: vi.fn(async ({ where, data }: any) => { const row = m.state.doc.items.find((i: any) => i.id === where.id); Object.assign(row, data, { unitCost: data.unitCost.toString(), totalCost: data.totalCost.toString() }); return row; }),
            aggregate: vi.fn(async () => ({ _sum: { quantity: 2, totalCost: new Prisma.Decimal('5.10') } })),
            count: vi.fn(async () => 1), findMany: vi.fn(async () => m.state.doc.items.map((i: any) => ({ ...i, writeOffId: 'wo', writeOff: m.state.doc }))),
        },
        auditLog: { create: vi.fn(async ({ data }: any) => { m.state.audit.push(data); }) },
    });
});

describe('write-off validation and valuation', () => {
    it.each([
        { productId: 'p', internalProductId: 'i', quantity: 1 }, { variationId: 12, quantity: 1 }, { productId: 'p', quantity: 0 },
        { productId: 'p', quantity: 1.5 }, { productId: 'p', quantity: 1, unitCostOverride: -1 }, { productId: 'p', quantity: 1, variationId: 'uuid' },
    ])('rejects invalid stock identity/quantity/cost %j', item => {
        expect(writeOffBodySchema.safeParse({ reason: 'DAMAGED', items: [item] }).success).toBe(false);
    });
    it('rejects duplicate lines and invalid date ranges', () => {
        const item = { productId: 'p', quantity: 1 };
        expect(writeOffBodySchema.safeParse({ reason: 'OTHER', items: [item, item] }).success).toBe(false);
        for (const query of [{ from: '2026-02-30' }, { from: '2026-03-01', to: '2026-01-01' }, { page: -1 }]) expect(writeOffQuerySchema.safeParse(query).success).toBe(false);
    });
    it('sums COGS plus extras exactly, preserves zero and requires override for absent COGS', () => {
        expect(writeOffUnitCost(new Prisma.Decimal('2.25'), [{ amount: 0.1 }, { amount: '0.2' }])?.toString()).toBe('2.55');
        expect(writeOffUnitCost(new Prisma.Decimal(0), [])?.toString()).toBe('0');
        expect(writeOffUnitCost(null, [{ amount: 5 }])).toBeNull();
        expect(writeOffUnitCost(null, [{ amount: 5 }], 0)?.toString()).toBe('0');
        expect(() => writeOffUnitCost(new Prisma.Decimal(2), [{ amount: 'bad' }])).toThrow('miscellaneous costs');
    });
});

describe('atomic write-off finalization', () => {
    it('snapshots current costs/name, decrements stock, audits the actor and journals a negative Woo delta exactly once', async () => {
        const result = await finalizeWriteOff('a', 'actor', 'wo');
        expect(result).toMatchObject({ status: 'FINALIZED', totalCost: 5.1, finalizedBy: 'actor', syncStatus: 'PENDING' });
        expect(result.items[0]).toMatchObject({ name: 'Current product', unitCost: 2.55, stockBefore: 10, stockAfter: 8 });
        expect(m.state.ops[0]).toMatchObject({ operationId: 'writeoff_line', sourceType: 'stock_write_off', delta: -2, sequence: 1n, stockOwnerWooId: 10 });
        expect(m.state.audit[0]).toMatchObject({ userId: 'actor', previousValue: { stock_quantity: 10 }, details: { stock_quantity: 8, reason: 'DAMAGED', actorId: 'actor' } });
        m.state.cogs = '999';
        expect((await finalizeWriteOff('a', 'second', 'wo')).totalCost).toBe(5.1);
        expect(m.state.stock).toBe(8); expect(m.state.ops).toHaveLength(1);
    });
    it('rolls back stock, intent, audit and document on late failure', async () => {
        m.state.failCommit = true;
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow('commit failed');
        expect(m.state.stock).toBe(10); expect(m.state.ops).toEqual([]); expect(m.state.audit).toEqual([]); expect(m.state.doc.status).toBe('DRAFT');
    });
    it.each([null, 1])('rejects unknown/insufficient stock %j without durable effects', async stock => {
        m.state.stock = stock;
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow(/unknown|insufficient/);
        expect(m.state.stock).toBe(stock); expect(m.state.ops).toEqual([]); expect(m.state.doc.status).toBe('DRAFT');
    });
    it('requires explicit zero override when costs are missing', async () => {
        m.state.cogs = null;
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow('unitCostOverride');
        m.state.doc.items[0].unitCostOverride = 0;
        expect((await finalizeWriteOff('a', 'actor', 'wo')).totalCost).toBe(0);
    });
    it.each(['frozen', 'legacy', 'blocked', 'bom'])('rejects unsupported %s inventory configurations', async config => {
        if (config === 'frozen') m.state.frozen = true;
        if (config === 'legacy') m.state.mode = 'LEGACY';
        if (config === 'blocked') m.state.capability = 'blocked';
        if (config === 'bom') m.state.boms = [{ items: [{ internalProductId: 'component' }] }];
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow();
        expect(m.state.stock).toBe(10); expect(m.state.ops).toEqual([]);
    });
    it('atomically queues internal cascade recovery without creating a Woo delta', async () => {
        Object.assign(m.state.doc.items[0], { productId: null, internalProductId: 'internal' });
        const result = await finalizeWriteOff('a', 'actor', 'wo');
        expect(result.items[0]).toMatchObject({ type: 'INTERNAL', cascadeState: 'pending', stockAfter: 8 });
        expect(m.state.ops).toEqual([]); expect(result.syncStatus).toBe('PENDING');
    });
    it.each([false, true])('resolves independently managed or inherited Woo variation owner (inherited=%s)', async inherited => {
        m.state.variable = true; m.state.inherited = inherited; m.state.doc.items[0].variationId = 11;
        const result = await finalizeWriteOff('a', 'actor', 'wo');
        expect(result.items[0]).toMatchObject({ variationId: 11, type: 'VARIATION', unitCost: 1 });
        expect(m.state.ops[0]).toMatchObject({ variationWooId: 11, variationId: inherited ? null : 'v11', stockOwnerWooId: inherited ? 10 : 11 });
        expect(m.sql.some(sql => sql.startsWith(`UPDATE "${inherited ? 'WooProduct' : 'ProductVariation'}"`))).toBe(true);
    });
    it.each([null, 0])('uses parent COGS and extras when variant COGS is %s', async variantCogs => {
        m.state.variable = true; m.state.doc.items[0].variationId = 11; m.state.variantCogs = variantCogs;
        expect((await finalizeWriteOff('a', 'actor', 'wo')).items[0].unitCost).toBe(2.55);
    });
    it('retains nonempty variant extras when falling back to parent COGS', async () => {
        m.state.variable = true; m.state.doc.items[0].variationId = 11; m.state.variantCogs = null; m.state.variantCosts = [{ amount: 4 }];
        expect((await finalizeWriteOff('a', 'actor', 'wo')).items[0].unitCost).toBe(6.25);
    });
    it('does not let an imported Woo observation erase an earlier queued write-off reservation', async () => {
        m.state.sequence = 1n;
        m.state.ops = [{ accountId: 'a', operationId: 'writeoff_old', sourceId: 'old', sourceType: 'stock_write_off', stockOwnerWooId: 10, sequence: 1n, delta: -4, state: 'pending' }];
        m.state.previousItems = [{ id: 'old', operationId: 'writeoff_old', stockAfter: 6 }];
        m.state.stock = 10; // Woo import still reports the pre-apply observation.
        const result = await finalizeWriteOff('a', 'actor', 'wo');
        expect(m.state.stock).toBe(4);
        expect(result.items[0]).toMatchObject({ stockBefore: 6, stockAfter: 4 });
    });
    it('uses the corrected reconciliation baseline plus later deltas, without subtracting the reconciled delta again', async () => {
        m.state.sequence = 2n;
        m.state.ops = [
            { accountId: 'a', operationId: 'corrected', stockOwnerWooId: 10, sequence: 1n, delta: -4, state: 'reconciled', stockQuantity: 7 },
            { accountId: 'a', operationId: 'queued', stockOwnerWooId: 10, sequence: 2n, delta: -2, state: 'pending' },
        ];
        m.state.stock = 20; // Inflated imported observation cannot override reservations.
        const result = await finalizeWriteOff('a', 'actor', 'wo');
        expect(result.items[0]).toMatchObject({ stockBefore: 5, stockAfter: 3 });
        expect(m.state.stock).toBe(3);
    });
    it('uses a reconciled baseline even after its queue has drained, rather than stale imported stock', async () => {
        m.state.sequence = 1n;
        m.state.ops = [{ accountId: 'a', operationId: 'corrected', stockOwnerWooId: 10, sequence: 1n, delta: -4, state: 'reconciled', stockQuantity: 3 }];
        expect((await finalizeWriteOff('a', 'actor', 'wo')).items[0]).toMatchObject({ stockBefore: 3, stockAfter: 1 });
    });
    it('retains a lower stock observation captured by a later queued write-off', async () => {
        m.state.sequence = 2n;
        m.state.ops = [
            { accountId: 'a', operationId: 'first', sourceId: 'first', sourceType: 'stock_write_off', stockOwnerWooId: 10, sequence: 1n, delta: -2, state: 'pending' },
            { accountId: 'a', operationId: 'second', sourceId: 'second', sourceType: 'stock_write_off', stockOwnerWooId: 10, sequence: 2n, delta: -2, state: 'pending' },
        ];
        m.state.previousItems = [{ id: 'first', operationId: 'first', stockAfter: 8 }, { id: 'second', operationId: 'second', stockAfter: 1 }];
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow('insufficient');
        expect(m.state.stock).toBe(10);
    });
    it('lets a later reconciliation replace an older queued snapshot, accounting for its delta once', async () => {
        m.state.sequence = 2n;
        m.state.ops = [
            { accountId: 'a', operationId: 'corrected', stockOwnerWooId: 10, sequence: 1n, delta: -4, state: 'reconciled', stockQuantity: 7, appliedAt: new Date('2026-09-23T12:00:00Z') },
            { accountId: 'a', operationId: 'queued', sourceId: 'old', sourceType: 'stock_write_off', stockOwnerWooId: 10, sequence: 2n, delta: -2, state: 'pending', createdAt: new Date('2026-09-23T11:00:00Z') },
        ];
        m.state.previousItems = [{ id: 'old', operationId: 'queued', stockAfter: 1 }];
        expect((await finalizeWriteOff('a', 'actor', 'wo')).items[0]).toMatchObject({ stockBefore: 5, stockAfter: 3 });
    });
    it('rejects overdraw against queued reservations and unknown older queue baselines', async () => {
        m.state.ops = [{ accountId: 'a', operationId: 'queued', sourceId: 'old', sourceType: 'stock_write_off', stockOwnerWooId: 10, sequence: 1n, delta: -9, state: 'pending' }];
        m.state.previousItems = [{ id: 'old', operationId: 'queued', stockAfter: 1 }];
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow('insufficient');
        m.state.ops[0].sourceType = 'purchase_order';
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow('baseline is unknown');
        expect(m.state.stock).toBe(10); expect(m.state.ops).toHaveLength(1); expect(m.state.doc.status).toBe('DRAFT');
    });
    it('locks the Account before picker target rows, matching finalization lock order', async () => {
        await writeOffProducts('a', '');
        expect(m.sql[0]).toContain('"Account"');
        expect(m.sql.findIndex(sql => sql.includes('"WooProduct"'))).toBeGreaterThan(0);
    });
    it.each(['product', 'internal'])('does not resolve an unlocked %s inserted after a missing lock lookup', async type => {
        m.state.missingLock = true;
        if (type === 'internal') Object.assign(m.state.doc.items[0], { productId: null, internalProductId: 'internal' });
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow(/not found|identity unavailable/);
        expect(m.db.wooProduct.findFirst).not.toHaveBeenCalled(); expect(m.db.internalProduct.findFirst).not.toHaveBeenCalled();
        expect(m.state.stock).toBe(10); expect(m.state.ops).toEqual([]);
    });
    it('freezes internal-only finalization and exposes internal retry failures as needing attention', async () => {
        Object.assign(m.state.doc.items[0], { productId: null, internalProductId: 'internal' }); m.state.frozen = true;
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow('frozen');
        expect(m.state.stock).toBe(10);
        m.state.doc.status = 'FINALIZED'; Object.assign(m.state.doc.items[0], { cascadeState: 'pending', cascadeError: 'Woo unavailable' });
        expect((await getWriteOff('a', 'wo')).syncStatus).toBe('NEEDS_ATTENTION');
    });
    it('shared-owner sibling quantities cannot overdraw stock and roll back the whole document', async () => {
        m.state.variable = true; m.state.inherited = true; m.state.stock = 3; m.state.doc.items[0].variationId = 11;
        m.state.doc.items.push({ ...m.state.doc.items[0], id: 'sibling', variationId: 12 });
        await expect(finalizeWriteOff('a', 'actor', 'wo')).rejects.toThrow('insufficient');
        expect(m.state.stock).toBe(3); expect(m.state.ops).toEqual([]); expect(m.state.audit).toEqual([]);
    });
    it('enforces tenant ownership and draft-only edits/deletes', async () => {
        await expect(getWriteOff('other', 'wo')).rejects.toMatchObject({ statusCode: 404 });
        await expect(finalizeWriteOff('other', 'actor', 'wo')).rejects.toMatchObject({ statusCode: 404 });
        m.state.doc.status = 'FINALIZED';
        await expect(deleteWriteOff('a', 'actor', 'wo')).rejects.toThrow('Only drafts');
        await expect(saveWriteOff('a', 'actor', { reason: 'OTHER', items: [{ productId: 'p', quantity: 1 }] }, 'wo')).rejects.toThrow('Only drafts');
    });
});

describe('write-off financial reporting', () => {
    it('uses inclusive UTC dates on finalizedAt, not creation date', () => {
        expect(writeOffWhere('tenant', writeOffQuerySchema.parse({ from: '2026-09-01', to: '2026-09-23', reason: 'DAMAGED' }))).toEqual({ accountId: 'tenant', reason: 'DAMAGED', finalizedAt: { gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-09-24T00:00:00Z') } });
    });
    it('returns frozen line values and an all-pages finalized summary', async () => {
        Object.assign(m.state.doc, { status: 'FINALIZED', finalizedAt: new Date() });
        Object.assign(m.state.doc.items[0], { unitCost: '2.55', totalCost: '5.1' }); m.state.cogs = '999';
        const result = await listWriteOffs('a', writeOffQuerySchema.parse({ reason: 'DAMAGED', page: 2 }), true);
        expect(result).toMatchObject({ total: 1, page: 2, pageSize: 500, summary: { quantity: 2, totalCost: 5.1, count: 1 } });
        expect(result.items[0]).toMatchObject({ unitCost: 2.55, totalCost: 5.1 });
        expect(m.db.stockWriteOffItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 500, where: { writeOff: expect.objectContaining({ accountId: 'a', reason: 'DAMAGED', status: 'FINALIZED', AND: [{ finalizedAt: { lt: new Date(result.asOf!) } }] }) } }));
        expect(m.db.stockWriteOffItem.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { writeOff: { AND: [expect.objectContaining({ accountId: 'a', reason: 'DAMAGED' }), { status: 'FINALIZED' }] } } }));
    });
});
