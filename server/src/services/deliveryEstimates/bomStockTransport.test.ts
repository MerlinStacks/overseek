import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ state: {} as any, db: {} as any, wooWrite: vi.fn(), redis: { get: vi.fn(), setex: vi.fn(), setnx: vi.fn(), expire: vi.fn(), del: vi.fn() }, failLedger: false }));
vi.mock('../../utils/prisma', () => ({ prisma: m.db }));
vi.mock('../../utils/redis', () => ({ redisClient: m.redis }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ updateProduct: m.wooWrite, updateProductVariation: m.wooWrite }) } }));
import { BOMConsumptionService } from '../BOMConsumptionService';
const matches = (row: any, where: any): boolean => Object.entries(where).every(([k, value]: [string, any]) =>
    value && typeof value === 'object' && 'in' in value ? value.in.includes(row[k]) : row[k] === value);
beforeEach(() => {
    vi.restoreAllMocks(); vi.clearAllMocks(); m.failLedger = false;
    m.state = { stock: 10, ops: [] as any[], ledgers: [] as any[], owner: 0n, cycles: {} as any };
    m.redis.get.mockResolvedValue(null); m.redis.setnx.mockResolvedValue(1);
    const product = { id: 'component', accountId: 'a', wooId: 10, manageStock: true, rawData: { id: 10, type: 'simple', manage_stock: true }, boms: [] };
    Object.assign(m.db, {
        $executeRaw: vi.fn(),
        $queryRaw: async (parts: TemplateStringsArray, ...args: any[]) => {
            const sql = parts.join('?');
            if (sql.includes('AS guarded')) return [{ guarded: true }];
            if (sql.startsWith('UPDATE')) { m.state.stock += args[0]; return [{ stock: m.state.stock }]; }
            return [];
        },
        $transaction: async (fn: any) => { const before = structuredClone(m.state); try { return await fn(m.db); } catch (error) { m.state = before; throw error; } },
        wooProduct: { findFirst: async ({ where }: any) => where.accountId === 'a' && (where.id === 'component' || where.wooId === 10) ? product : null },
        receiptAccount: { upsert: async () => ({ accountId: 'a' }) },
        receiptOwner: { upsert: async () => ({ lastSequence: ++m.state.owner }) },
        receiptCycle: { upsert: async ({ where, create }: any) => m.state.cycles[where.id] ??= create },
        receiptOperation: {
            findUnique: async ({ where }: any) => m.state.ops.find((o: any) => matches(o, where)) ?? null,
            findUniqueOrThrow: async ({ where }: any) => m.state.ops.find((o: any) => matches(o, where)),
            findFirst: async ({ where }: any) => m.state.ops.find((o: any) => matches(o, where)) ?? null,
            create: async ({ data }: any) => { const op = { state: 'pending', ...data }; m.state.ops.push(op); return op; },
        },
        bOMDeductionLedger: {
            findFirst: async ({ where }: any) => m.state.ledgers.find((o: any) => matches(o, where)) ?? null,
            findMany: async ({ where }: any) => m.state.ledgers.filter((o: any) => matches(o, where)),
            create: async ({ data }: any) => { if (m.failLedger) throw new Error('ledger unavailable'); m.state.ledgers.push(data); return data; },
            update: async ({ where, data }: any) => Object.assign(m.state.ledgers.find((o: any) => matches(o, where)), data),
            updateMany: async ({ where, data }: any) => { const rows = m.state.ledgers.filter((o: any) => matches(o, where)); rows.forEach((o: any) => Object.assign(o, data)); return { count: rows.length }; },
        },
    });
    vi.spyOn(BOMConsumptionService as any, 'planLineItemDeductions').mockResolvedValue([{ componentType: 'WooProduct', componentId: 'component', componentName: 'Component', wooId: 10, quantityDeducted: 2, previousStock: 10, newStock: 8 }]);
    vi.spyOn(BOMConsumptionService, 'cascadeSyncAffectedProducts').mockResolvedValue(undefined);
});
const order = { id: 123, status: 'processing', line_items: [{ product_id: 20, quantity: 1 }] };
describe('guarded BOM order inventory bridge', () => {
    it('queues one native deduction atomically and never publishes an absolute component stock value', async () => {
        await BOMConsumptionService.consumeOrderComponents('a', order);
        expect(m.state.stock).toBe(8); expect(m.state.ops).toHaveLength(1);
        expect(m.state.ops[0]).toMatchObject({ sourceType: 'bom_consumption', delta: -2, stockOwnerWooId: 10, cascadeState: 'waiting_receipt' });
        expect(m.state.ledgers[0]).toMatchObject({ status: 'QUEUED_GUARDED', guardedOperationId: m.state.ops[0].operationId });
        expect(m.wooWrite).not.toHaveBeenCalled(); expect(BOMConsumptionService.cascadeSyncAffectedProducts).not.toHaveBeenCalled();
        await BOMConsumptionService.consumeOrderComponents('a', order);
        expect(m.state.ops).toHaveLength(1); expect(m.state.stock).toBe(8);
    });
    it('cancellation queues a single ordered inverse even before native consumption ACK, never a legacy restock', async () => {
        await BOMConsumptionService.consumeOrderComponents('a', order);
        await BOMConsumptionService.reverseOrderConsumption('a', order);
        await BOMConsumptionService.reverseOrderConsumption('a', order);
        expect(m.state.stock).toBe(10);
        expect(m.state.ops.map((o: any) => [o.sequence, o.delta])).toEqual([[1n, -2], [2n, 2]]);
        expect(m.state.ledgers[0].status).toBe('REVERSED'); expect(m.wooWrite).not.toHaveBeenCalled();
    });
    it('reactivates a reversed order despite a stale Redis completion hint, using a fresh ordered intent', async () => {
        await BOMConsumptionService.consumeOrderComponents('a', order);
        await BOMConsumptionService.reverseOrderConsumption('a', order);
        m.redis.get.mockResolvedValue('stale-completion');
        await BOMConsumptionService.consumeOrderComponents('a', order);
        expect(m.state.stock).toBe(8);
        expect(m.state.ops.map((o: any) => [o.sequence, o.delta])).toEqual([[1n, -2], [2n, 2], [3n, -2]]);
        expect(m.wooWrite).not.toHaveBeenCalled();
    });
    it('rolls back the local deduction and native outbox together on ledger failure', async () => {
        m.failLedger = true;
        await expect(BOMConsumptionService.consumeOrderComponents('a', order)).rejects.toThrow('ledger unavailable');
        expect(m.state.stock).toBe(10); expect(m.state.ops).toEqual([]); expect(m.wooWrite).not.toHaveBeenCalled();
    });
});
