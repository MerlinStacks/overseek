import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductsService } from '../products';
import { prisma } from '../../utils/prisma';
import { projectInbound } from '../deliveryEstimates/inbound';

// Mock prisma
vi.mock('../../utils/prisma', () => ({
    prisma: {
        $transaction: vi.fn(),
        $queryRaw: vi.fn(),
        deliverySyncAccount: { upsert: vi.fn() },
        deliveryInboundDirtyTarget: { upsert: vi.fn() },
        deliveryInputSync: { findMany: vi.fn() },
        supplier: { findFirst: vi.fn() },
        wooProduct: {
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(),
        },
        productVariation: {
            upsert: vi.fn(),
            findMany: vi.fn(),
        }
    }
}));

// Mock WooService - updateProductVariation is called for variations, not updateProduct
const mockUpdateProductVariation = vi.fn();
const mockUpdateProduct = vi.fn();
vi.mock('../woo', () => ({
    WooService: {
        forAccount: vi.fn(() => ({
            updateProductVariation: mockUpdateProductVariation,
            updateProduct: mockUpdateProduct,
        }))
    }
}));

// Mock Logger to suppress output
vi.mock('../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock Redis — variation sync clears 404 tracking keys on success
vi.mock('../../utils/redis', () => ({
    redisClient: {
        del: vi.fn().mockResolvedValue(0),
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockResolvedValue('OK'),
    }
}));

describe('ProductsService.updateProduct Performance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
        vi.mocked(prisma.wooProduct.findUniqueOrThrow).mockResolvedValue({ supplierId: 'old', manageStock: false, rawData: { manage_stock: false } } as any);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([{ wooId: 10 }] as any);
        vi.mocked(prisma.deliveryInputSync.findMany).mockResolvedValue([]);
        vi.mocked(prisma.productVariation.findMany).mockResolvedValue([]);
        vi.mocked(prisma.productVariation.upsert).mockResolvedValue({} as any);
        mockUpdateProductVariation.mockResolvedValue({});
        mockUpdateProduct.mockResolvedValue({});
    });

    it('persists supplier reassignment and dirty intent atomically, before remote work', async () => {
        vi.mocked(prisma.wooProduct.findUnique).mockResolvedValue({ id: 'p', rawData: {} } as any);
        vi.mocked(prisma.supplier.findFirst).mockResolvedValue({ id: 's' } as any);
        let committed = { supplierId: 'old', dirty: false };
        let fail = true;
        vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
            const staged = { ...committed };
            const tx = { ...prisma, deliverySyncAccount: { upsert: async () => { staged.dirty = true; } },
                wooProduct: { ...prisma.wooProduct, update: async ({ data }: any) => { staged.supplierId = data.supplierId; if (fail) throw new Error('write failed'); return { id: 'p' }; } } };
            const result = await callback(tx); committed = staged; return result;
        });
        await expect(ProductsService.updateProduct('a', 10, { supplierId: 's' })).rejects.toThrow('write failed');
        expect(committed).toEqual({ supplierId: 'old', dirty: false });
        fail = false;
        await ProductsService.updateProduct('a', 10, { supplierId: 's' });
        expect(committed).toEqual({ supplierId: 's', dirty: true });
        expect(prisma.supplier.findFirst).toHaveBeenCalledWith({ where: { id: 's', accountId: 'a' }, select: { id: true } });
    });

    it('processes variations in batches (fast)', async () => {
        const accountId = 'acc_123';
        const wooId = 123;
        const variations = Array.from({ length: 10 }, (_, i) => ({
            id: 1000 + i,
            sku: `VAR-${i}`,
            price: '10.00',
            salePrice: '9.00',
            stockStatus: 'instock'
        }));

        const data = {
            name: 'Test Product',
            variations
        };

        (prisma.wooProduct.findUnique as any).mockResolvedValue({
            id: 'local_123',
            rawData: {}
        });
        (prisma.wooProduct.update as any).mockResolvedValue({
            id: 'local_123'
        });
        (prisma.productVariation.upsert as any).mockResolvedValue({});

        // Simulate 100ms latency per variation update
        mockUpdateProductVariation.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return {};
        });

        const start = Date.now();
        await ProductsService.updateProduct(accountId, wooId, data);
        const end = Date.now();
        const duration = end - start;

        console.log(`Duration (Batched, size=5): ${duration}ms`);

        // Batched (5 at a time): 10 variations = 2 batches × 100ms ≈ 200ms
        expect(duration).toBeLessThan(500);
        expect(mockUpdateProductVariation).toHaveBeenCalledTimes(10);
        expect(prisma.deliveryInboundDirtyTarget.upsert).not.toHaveBeenCalled();
        expect(prisma.deliverySyncAccount.upsert).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it.each([{ name: 'new name' }, { price: '20' }, { focusKeyword: 'SEO' }, { supplierId: 'old', manageStock: false }])('does not queue unrelated or unchanged parent fields: %j', async data => {
        vi.mocked(prisma.wooProduct.findUnique).mockResolvedValue({ id: 'p', supplierId: 'old', manageStock: false, rawData: { manage_stock: false } } as any);
        vi.mocked(prisma.wooProduct.update).mockResolvedValue({ id: 'p' } as any);
        vi.mocked(prisma.supplier.findFirst).mockResolvedValue({ id: 'old' } as any);
        await ProductsService.updateProduct('a', 10, data);
        expect(prisma.deliveryInboundDirtyTarget.upsert).not.toHaveBeenCalled();
        expect(prisma.deliverySyncAccount.upsert).not.toHaveBeenCalled();
        expect(prisma.wooProduct.findMany).not.toHaveBeenCalled();
    });
    it('queues a changed stock owner only for that configured parent', async () => {
        vi.mocked(prisma.wooProduct.findUnique).mockResolvedValue({ id: 'p', rawData: { manage_stock: false } } as any);
        vi.mocked(prisma.wooProduct.update).mockResolvedValue({ id: 'p' } as any);
        await ProductsService.updateProduct('a', 10, { manageStock: true });
        expect(prisma.deliveryInboundDirtyTarget.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.deliveryInboundDirtyTarget.upsert).toHaveBeenCalledWith({ where: { accountId_wooId: { accountId: 'a', wooId: 10 } }, create: { accountId: 'a', wooId: 10 }, update: { version: { increment: 1 } } });
        expect(prisma.deliverySyncAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { inboundRequested: true, inboundVersion: { increment: 1 } } }));
    });
    it.each([true, false])('honors explicit parent manageStock=%s in both local and Woo writes', async manageStock => {
        const before = { id: 'p', manageStock: !manageStock, stockQuantity: 17, rawData: { manage_stock: !manageStock } };
        vi.mocked(prisma.wooProduct.findUnique).mockResolvedValue(before as any);
        vi.mocked(prisma.wooProduct.findUniqueOrThrow).mockResolvedValue(before as any);
        vi.mocked(prisma.wooProduct.update).mockResolvedValue({ id: 'p' } as any);
        await ProductsService.updateProduct('a', 10, { manageStock });
        expect(prisma.wooProduct.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ manageStock, rawData: expect.objectContaining({ manage_stock: manageStock }) }) }));
        expect(mockUpdateProduct).toHaveBeenCalledWith(10, { manage_stock: manageStock, stock_quantity: 17 });
    });
    it.each([
        { before: 'parent', requested: true, state: 'pending', owner: 11 },
        { before: false, requested: true, state: 'pending', owner: 11 },
        { before: true, requested: 'parent', state: 'unsupported', owner: null },
        { before: true, requested: false, state: 'unsupported', owner: null },
    ])('persists variation ownership $before -> $requested and rebuilds the correct target state', async ({ before, requested, state, owner }) => {
        let variation: any = { wooId: 11, productId: 'p', manageStock: before === true, rawData: { manage_stock: before, custom: 'preserved' }, stockQuantity: 17 };
        const parent = { id: 'p', wooId: 10, accountId: 'a', manageStock: true, rawData: { type: 'variable', manage_stock: true }, supplierId: null, supplier: null, boms: [] };
        vi.mocked(prisma.wooProduct.findUnique).mockResolvedValue(parent as any);
        vi.mocked(prisma.wooProduct.update).mockResolvedValue({ id: 'p' } as any);
        vi.mocked(prisma.productVariation.findMany).mockImplementation((async () => [variation]) as any);
        vi.mocked(prisma.productVariation.upsert).mockImplementation((async ({ update }: any) => { variation = { ...variation, manageStock: update.manageStock, rawData: update.rawData }; return variation; }) as any);
        await ProductsService.updateProduct('a', 10, { variations: [{ id: 11, manageStock: requested }] });
        expect(variation).toMatchObject({ manageStock: requested === true, rawData: { manage_stock: requested, custom: 'preserved' }, stockQuantity: 17 });
        expect(prisma.productVariation.findMany).toHaveBeenCalledWith({ where: { productId: 'p', product: { accountId: 'a' }, wooId: { in: [11] } }, select: { wooId: true, manageStock: true, rawData: true } });
        expect(prisma.deliveryInboundDirtyTarget.upsert).toHaveBeenCalledTimes(1);
        expect(mockUpdateProductVariation).toHaveBeenCalledWith(10, 11, expect.objectContaining({ manage_stock: requested }));
        const projection = projectInbound(10, { ...parent, variations: [variation] }, [], new Date('2026-09-21T12:00:00Z'));
        expect(projection.targets[1]).toMatchObject({ state, stockOwnerWooId: owner });
        expect(projection.receiptSafety).toBe('unverified');
        expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(prisma.productVariation.upsert).mock.invocationCallOrder[0]);
    });
    it('preserves omitted variation ownership, including inheritance, without reads or dirty work', async () => {
        vi.mocked(prisma.wooProduct.findUnique).mockResolvedValue({ id: 'p', rawData: {} } as any);
        vi.mocked(prisma.wooProduct.update).mockResolvedValue({ id: 'p' } as any);
        await ProductsService.updateProduct('a', 10, { variations: [{ id: 11, price: '20' }] });
        const write = vi.mocked(prisma.productVariation.upsert).mock.calls[0][0];
        expect(write.update).not.toHaveProperty('manageStock'); expect(write.update).not.toHaveProperty('rawData');
        expect(prisma.productVariation.findMany).not.toHaveBeenCalled(); expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.deliveryInboundDirtyTarget.upsert).not.toHaveBeenCalled();
        expect(mockUpdateProductVariation.mock.calls[0][2].manage_stock).toBeUndefined();
    });
    it('uses one bulk ownership read and one parent invalidation per changed batch, skipping unchanged batches', async () => {
        vi.mocked(prisma.wooProduct.findUnique).mockResolvedValue({ id: 'p', rawData: {} } as any);
        vi.mocked(prisma.wooProduct.update).mockResolvedValue({ id: 'p' } as any);
        const rows = Array.from({ length: 10 }, (_, n) => ({ wooId: n + 11, manageStock: n >= 5, rawData: { manage_stock: n >= 5 } }));
        vi.mocked(prisma.productVariation.findMany).mockImplementation((async ({ where }: any) => rows.filter(row => where.wooId.in.includes(row.wooId))) as any);
        await ProductsService.updateProduct('a', 10, { variations: rows.map(row => ({ id: row.wooId, manageStock: true })) });
        expect(prisma.productVariation.findMany).toHaveBeenCalledTimes(2);
        expect(prisma.deliveryInboundDirtyTarget.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.wooProduct.findMany).toHaveBeenCalledTimes(1);
        expect(mockUpdateProductVariation).toHaveBeenCalledTimes(10);
    });
    it('rolls variation ownership back when targeted invalidation fails, before variation transport', async () => {
        vi.mocked(prisma.wooProduct.findUnique).mockResolvedValue({ id: 'p', rawData: {} } as any);
        vi.mocked(prisma.wooProduct.update).mockResolvedValue({ id: 'p' } as any);
        let committed = { wooId: 11, manageStock: false, rawData: { manage_stock: 'parent' } };
        vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
            let staged = structuredClone(committed);
            const tx = { ...prisma, productVariation: { findMany: async () => [staged], upsert: async ({ update }: any) => { staged = { ...staged, manageStock: update.manageStock, rawData: update.rawData }; } }, deliveryInboundDirtyTarget: { upsert: async () => { throw new Error('dirty failed'); } } };
            const result = await callback(tx); committed = staged; return result;
        });
        await expect(ProductsService.updateProduct('a', 10, { variations: [{ id: 11, manageStock: true }] })).rejects.toThrow('dirty failed');
        expect(committed).toEqual({ wooId: 11, manageStock: false, rawData: { manage_stock: 'parent' } });
        expect(mockUpdateProductVariation).not.toHaveBeenCalled();
    });
});
