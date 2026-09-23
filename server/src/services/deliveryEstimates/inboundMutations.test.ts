import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), find: vi.fn(), supplier: vi.fn(), products: vi.fn(), variations: vi.fn(), woo: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: mocks.transaction, purchaseOrder: { findFirst: mocks.find }, supplier: { findFirst: mocks.supplier }, wooProduct: { findMany: mocks.products }, supplierItem: { findMany: vi.fn() }, productVariation: { findMany: mocks.variations } } }));
vi.mock('../woo', () => ({ WooService: { forAccount: mocks.woo } }));
vi.mock('../BOMConsumptionService', () => ({ BOMConsumptionService: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { PurchaseOrderService } from '../PurchaseOrderService';

let state: { status: string; dirty: number; deleted: boolean; items: unknown[]; targets: number[] };
let failIntent: boolean;
let events: string[];
const service = new PurchaseOrderService();
describe('PO inbound invalidation atomicity and lock order', () => {
    beforeEach(() => {
        vi.resetAllMocks(); state = { status: 'DRAFT', dirty: 0, deleted: false, items: [{ productId: 'p', product: null, quantity: 3 }], targets: [] }; failIntent = false; events = [];
        mocks.find.mockImplementation(async () => ({ id: 'po', status: state.status }));
        mocks.supplier.mockResolvedValue({ id: 's' }); mocks.products.mockResolvedValue([{ id: 'p' }]); mocks.variations.mockResolvedValue([]);
        mocks.woo.mockRejectedValue(new Error('Account missing WooCommerce credentials'));
        mocks.transaction.mockImplementation(async callback => {
            const staged = structuredClone(state);
            const tx = {
                receiptAccount: { findUnique: async () => null, upsert: async () => ({ accountId: 'a' }) },
                $queryRaw: async () => { events.push('account-lock'); return []; },
                $executeRaw: async () => { events.push('po-lock'); },
                deliverySyncAccount: { upsert: async () => { events.push('dirty'); if (failIntent) throw new Error('dirty unavailable'); staged.dirty++; } },
                deliveryInboundDirtyTarget: { upsert: async ({ create }: any) => { staged.targets.push(create.wooId); } },
                deliveryInputSync: { findMany: async () => [] },
                wooProduct: { findMany: async ({ where }: any) => {
                    expect(where.accountId).toBe('a');
                    expect(where.id?.in || where.wooId?.in).toBeDefined();
                    return [{ id: 'p', wooId: 10 }, { id: 'q', wooId: 20 }].filter(p => where.id ? where.id.in.includes(p.id) : where.wooId.in.includes(p.wooId));
                } },
                purchaseOrder: {
                    findFirst: async () => ({ id: 'po', accountId: 'a', status: staged.status, items: staged.items }),
                    create: async ({ data }: any) => { events.push('write'); staged.status = data.status; return { id: 'po' }; },
                    update: async ({ data }: any) => { events.push('write'); if (data.status) staged.status = data.status; if (data.items) staged.items = data.items.create; return { id: 'po' }; },
                    updateMany: async ({ data }: any) => { events.push('write'); if (data.status) staged.status = data.status; return { count: 1 }; },
                    delete: async () => { events.push('write'); staged.deleted = true; },
                },
                purchaseOrderItem: { deleteMany: async () => { events.push('write'); staged.items = []; } },
            };
            const result = await callback(tx); state = staged; return result;
        });
    });
    const operations = [
        ['create', () => service.createPurchaseOrder('a', { supplierId: 's', items: [{ productId: 'p', quantity: 2, unitCost: 1, name: 'private' }], status: 'ORDERED' })],
        ['update fields', () => service.updatePurchaseOrder('a', 'po', { status: 'ORDERED' })],
        ['replace lines', () => service.updatePurchaseOrder('a', 'po', { items: [] })],
        ['delete', () => service.deletePurchaseOrder('a', 'po')],
        ['receipt', () => service.receiveStock('a', 'po')],
        ['reversal', () => service.unreceiveStock('a', 'po')],
    ] as const;
    it.each(operations)('%s commits a durable intent under account-first lock ordering', async (name, operation) => {
        if (name === 'reversal') state.status = 'RECEIVED';
        await operation();
        expect(state.dirty).toBe(1); expect(events[0]).toBe('account-lock');
        expect(state.targets).toEqual([10]);
        expect(events.indexOf('account-lock')).toBeLessThan(events.indexOf('write'));
        if (name === 'receipt' || name === 'reversal') expect(events.slice(0, 2)).toEqual(['account-lock', 'po-lock']);
        else expect(mocks.woo).not.toHaveBeenCalled();
    });
    it('line replacement queues the tenant-resolved union of old and new parent IDs', async () => {
        mocks.products.mockResolvedValue([{ id: 'q' }]);
        await service.updatePurchaseOrder('a', 'po', { items: [{ productId: 'q', quantity: 4, unitCost: 1, name: 'private' }] });
        expect(state.targets).toEqual([10, 20]);
    });
    it('empty/unlinked POs create no inbound account or targets', async () => {
        state.items = [];
        await service.createPurchaseOrder('a', { supplierId: 's', items: [] });
        await service.updatePurchaseOrder('a', 'po', { notes: 'note' });
        expect(state.dirty).toBe(0); expect(state.targets).toEqual([]);
    });
    it('notes and tracking edits do not rebuild existing linked product projections', async () => {
        await service.updatePurchaseOrder('a', 'po', { notes: 'note', trackingNumber: 'tracking' });
        expect(state.dirty).toBe(0); expect(state.targets).toEqual([]);
    });
    it.each(operations)('%s rolls source mutations back if the dirty intent fails', async (name, operation) => {
        if (name === 'reversal') state.status = 'RECEIVED';
        const before = structuredClone(state); failIntent = true;
        await expect(operation()).rejects.toThrow('dirty unavailable');
        expect(state).toEqual(before); expect(mocks.woo).not.toHaveBeenCalled();
    });
    it('rejects direct variation mappings that do not belong to the linked tenant parent', async () => {
        await expect(service.createPurchaseOrder('a', { supplierId: 's', items: [{ productId: 'p', variationWooId: 99, quantity: 2, unitCost: 3, name: 'private' }] })).rejects.toThrow('Variation not found for linked parent product');
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.variations).toHaveBeenCalledWith({ where: { product: { accountId: 'a' }, OR: [{ productId: 'p', wooId: 99 }] }, select: { productId: true, wooId: true } });
    });
    it('idempotent receipt skips do not dirty or dispatch stock again', async () => {
        state.status = 'RECEIVED'; await service.receiveStock('a', 'po');
        expect(state.dirty).toBe(0); expect(mocks.woo).not.toHaveBeenCalled();
    });
});
