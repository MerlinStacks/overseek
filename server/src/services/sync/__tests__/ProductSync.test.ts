import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductSync } from '../ProductSync';
import { IndexingService } from '../../search/IndexingService';
import { Logger } from '../../../utils/logger';
import { EventBus } from '../../events';

// Mock dependencies
const mockPrisma = vi.hoisted(() => ({
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    bOMItem: { updateMany: vi.fn() },
    bOM: { deleteMany: vi.fn() },
    wooProduct: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        upsert: vi.fn().mockResolvedValue({}),
        delete: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    productVariation: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    account: {
        findUnique: vi.fn(),
    },
}));

// Fix path to point to src/utils/prisma from src/services/sync/__tests__
vi.mock('../../../utils/prisma', () => ({
    prisma: mockPrisma
}));
vi.mock('../../../utils/cache', () => ({ invalidateCache: vi.fn() }));
vi.mock('../../deliveryEstimates/intents', () => ({ lockDeliveryAccount: vi.fn(), dirtyInboundProducts: vi.fn() }));
vi.mock('../../wholesale/reconciliation', () => ({ reconcileWholesaleProductsBestEffort: vi.fn() }));

vi.mock('../../woo', () => ({
    WooService: vi.fn()
}));

vi.mock('../../search/IndexingService', () => ({
    IndexingService: {
        deleteProduct: vi.fn().mockResolvedValue(undefined),
        indexProduct: vi.fn().mockResolvedValue(undefined),
        bulkIndexProducts: vi.fn().mockResolvedValue(undefined),
    }
}));

vi.mock('../../SeoScoringService', () => ({
    SeoScoringService: {
        calculateScore: vi.fn().mockReturnValue({ score: 0, tests: [] })
    }
}));

vi.mock('../../MerchantCenterService', () => ({
    MerchantCenterService: {
        validateCompliance: vi.fn().mockReturnValue({ score: 0, issues: [] })
    }
}));

vi.mock('../../EmbeddingService', () => ({
    EmbeddingService: {
        updateProductEmbedding: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('../../events', () => ({
    EventBus: {
        emit: vi.fn()
    },
    EVENTS: {
        PRODUCT: { SYNCED: 'product.synced' }
    }
}));

vi.mock('../../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}));

describe('ProductSync Reconciliation Performance', () => {
    let productSync: ProductSync;
    const accountId = 'test-account';

    beforeEach(() => {
        vi.clearAllMocks();
        productSync = new ProductSync();
        mockPrisma.$transaction.mockImplementation(async work => work(mockPrisma));
        mockPrisma.wooProduct.count.mockReset().mockResolvedValue(0);
        mockPrisma.wooProduct.upsert.mockReset().mockResolvedValue({ id: 'p', wooId: 10 });
        mockPrisma.wooProduct.findMany.mockReset().mockResolvedValue([]);
        mockPrisma.wooProduct.findUnique.mockReset().mockResolvedValue({ id: 'stale', wooId: 100, rawData: {} });
        mockPrisma.productVariation.findMany.mockReset().mockResolvedValue([]);
        mockPrisma.bOMItem.updateMany.mockResolvedValue({ count: 0 });
    });

    it.each([true, false])('promptly cleans explicit simple products (incremental=%s)', async incremental => {
        vi.spyOn(productSync as any, 'getLastSync').mockResolvedValue(undefined);
        const woo = {
            getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 10, name: 'Simple', type: 'simple', variations: [11] }], totalPages: 1 })
                .mockResolvedValue({ data: [], totalPages: 1 }),
            getProductVariations: vi.fn()
        };
        mockPrisma.wooProduct.upsert.mockResolvedValue({ id: 'p', wooId: 10 });
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 10 }]);
        mockPrisma.wooProduct.count.mockResolvedValue(0);
        await (productSync as any).sync(woo, accountId, incremental);
        expect(mockPrisma.productVariation.updateMany).toHaveBeenCalledWith({ where: { productId: 'p', product: { accountId }, wooId: { notIn: [] }, deliveryActive: true }, data: { deliveryActive: false } });
        expect(mockPrisma.bOM.deleteMany).not.toHaveBeenCalled();
        expect(woo.getProductVariations).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.findMany.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(IndexingService.bulkIndexProducts).mock.invocationCallOrder[0]);
    });

    it('does not delete variations for a missing type even in full reconciliation', async () => {
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 10, name: 'Unknown' }], totalPages: 1 })
            .mockResolvedValue({ data: [], totalPages: 1 }) };
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 10 }]);
        mockPrisma.wooProduct.count.mockResolvedValue(0);
        await (productSync as any).sync(woo, accountId, false);
        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
    });

    it('fails the sync checkpoint when simple cleanup fails', async () => {
        vi.spyOn(productSync as any, 'getLastSync').mockResolvedValue(undefined);
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 10, name: 'Simple', type: 'simple' }], totalPages: 1 })
            .mockResolvedValue({ data: [], totalPages: 1 }) };
        mockPrisma.wooProduct.upsert.mockResolvedValue({ id: 'p', wooId: 10 });
        mockPrisma.wooProduct.findMany.mockResolvedValue([]);
        mockPrisma.productVariation.findMany.mockRejectedValueOnce(new Error('cleanup failed'));
        await expect((productSync as any).sync(woo, accountId, true)).rejects.toThrow('checkpoint was not advanced');
        expect(IndexingService.bulkIndexProducts).toHaveBeenCalledWith(accountId, []);
        expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
    });

    it('persists parent-managed Woo variations without coercing the owner marker to Boolean true', async () => {
        const woo = {
            getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 10, name: 'Variable', type: 'variable', price: '10', manage_stock: true }], totalPages: 1 })
                .mockResolvedValue({ data: [], totalPages: 1 }),
            getProductVariations: vi.fn().mockResolvedValue([{ id: 11, manage_stock: 'parent', price: '10', stock_quantity: null }]),
        };
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 10, accountId, rawData: {}, seoData: {} }]);
        mockPrisma.wooProduct.count.mockResolvedValue(0);
        await (productSync as any).sync(woo, accountId, false);
        expect(mockPrisma.productVariation.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ productId: 'p', wooId: 11, manageStock: false, rawData: expect.objectContaining({ manage_stock: 'parent' }) }),
            update: expect.objectContaining({ manageStock: false, rawData: expect.objectContaining({ manage_stock: 'parent' }) }),
        }));
        // Woo snapshots must not overwrite locally managed variant overrides.
        const update = mockPrisma.productVariation.upsert.mock.calls[0][0].update;
        for (const field of ['supplierId', 'cogs', 'miscCosts', 'binLocation', 'isGoldPriceApplied', 'goldPriceType']) {
            expect(update).not.toHaveProperty(field);
        }
    });

    it('never imports remote native or third-party costs into local product or variation COGS', async () => {
        const remoteCost = { cost_of_goods_sold: { values: [{ defined_value: 999 }], total_value: 999 }, meta_data: [{ key: '_wc_cog_cost', value: '999' }] };
        const woo = {
            getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 10, name: 'Variable', type: 'variable', price: '10', ...remoteCost }], totalPages: 1 })
                .mockResolvedValue({ data: [], totalPages: 1 }),
            getProductVariations: vi.fn().mockResolvedValue([{ id: 11, price: '10', ...remoteCost }]),
        };
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 10, accountId, cogs: 0, rawData: {}, seoData: {} }]);
        mockPrisma.wooProduct.count.mockResolvedValue(0);
        await (productSync as any).sync(woo, accountId, false);
        for (const model of [mockPrisma.wooProduct, mockPrisma.productVariation]) {
            expect(model.upsert).toHaveBeenCalledTimes(1);
            const write = model.upsert.mock.calls[0][0];
            expect(write.update).not.toHaveProperty('cogs');
            expect(write.create).not.toHaveProperty('cogs');
        }
    });

    it('confirms missing products but retains history until safe retirement is supported', async () => {
        // Setup mock WooService to return one product (so reconciliation triggers, but it's different from local ones)
        const mockWooService = {
            getProduct: vi.fn().mockRejectedValue({ response: { status: 404, data: { code: 'woocommerce_rest_product_invalid_id' } } }),
            getProducts: vi.fn()
                .mockResolvedValueOnce({
                    data: [{ id: 999, name: 'Safe Product', type: 'grouped', price: '10.00' }],
                    totalPages: 1
                })
                .mockResolvedValue({ data: [], totalPages: 1 }) // Subsequent calls empty
        };

        // Setup local products that need to be deleted
        const productCount = 10;
        const localProducts = Array.from({ length: productCount }, (_, i) => ({
            id: i + 1,
            wooId: 100 + i,
            accountId
        }));

        mockPrisma.wooProduct.findMany.mockResolvedValue(localProducts);
        mockPrisma.wooProduct.count.mockResolvedValueOnce(productCount).mockResolvedValueOnce(productCount);
        mockPrisma.wooProduct.delete.mockResolvedValue({});
        mockPrisma.wooProduct.deleteMany.mockResolvedValue({ count: 1 });

        // Run sync (non-incremental to trigger reconciliation)
        // Accessing protected member via any cast
        await (productSync as any).sync(mockWooService as any, accountId, false);

        // Assert optimized behavior
        expect(mockPrisma.wooProduct.delete).toHaveBeenCalledTimes(0);
        expect(mockPrisma.wooProduct.deleteMany).not.toHaveBeenCalled();
        expect(Logger.warn).toHaveBeenCalledWith('Confirmed missing Woo product retained: catalogue retirement required', {
            accountId, productId: 100, code: 'woocommerce_rest_product_invalid_id',
        });

        // Verify IndexingService is still called for each product
        expect(IndexingService.deleteProduct).not.toHaveBeenCalled();
        expect(mockWooService.getProduct).toHaveBeenCalledWith(100, { bypassCache: true });
    });

    it.each([true, false])('preserves explicit trash and ignores live responses from trash scan (incremental=%s)', async incremental => {
        vi.spyOn(productSync as any, 'getLastSync').mockResolvedValue(undefined);
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [], totalPages: 1 }).mockResolvedValueOnce({ data: [{ id: 100, status: 'trash', type: 'simple' }, { id: 101, status: 'publish' }], totalPages: 1 }) };
        await (productSync as any).sync(woo, accountId, incremental);
        expect(mockPrisma.wooProduct.update).toHaveBeenCalledWith({ where: { id: 'stale', accountId }, data: { status: 'trash', rawData: { status: 'trash' } } });
        expect(IndexingService.deleteProduct).toHaveBeenCalledExactlyOnceWith(accountId, 100);
        expect(mockPrisma.wooProduct.deleteMany).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
        if (!incremental) expect(mockPrisma.wooProduct.update.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.wooProduct.count.mock.invocationCallOrder[0]);
    });

    it.each([true, false])('propagates trash search failures (incremental=%s)', async incremental => {
        vi.spyOn(productSync as any, 'getLastSync').mockResolvedValue(undefined);
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [], totalPages: 1 }).mockResolvedValue({ data: [{ id: 100, status: 'trash' }], totalPages: 1 }) };
        vi.mocked(IndexingService.deleteProduct).mockRejectedValueOnce(new Error('search down'));
        await expect((productSync as any).sync(woo, accountId, incremental)).rejects.toThrow('search down');
        expect(mockPrisma.wooProduct.count).not.toHaveBeenCalled();
    });

    it('does not run missing reconciliation when the trash scan is unavailable', async () => {
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [], totalPages: 1 }).mockRejectedValueOnce(new Error('trash scan failed')) };
        await expect((productSync as any).sync(woo, accountId, false)).rejects.toThrow('trash scan failed');
        expect(mockPrisma.wooProduct.count).not.toHaveBeenCalled();
        expect(mockPrisma.wooProduct.deleteMany).not.toHaveBeenCalled();
    });

    it('handles explicit simple trash in the normal enumeration without retiring variants', async () => {
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 100, type: 'simple', status: 'trash' }], totalPages: 1 }).mockResolvedValue({ data: [], totalPages: 1 }) };
        await (productSync as any).sync(woo, accountId, false);
        expect(mockPrisma.wooProduct.upsert).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
        expect(mockPrisma.bOMItem.updateMany).not.toHaveBeenCalled();
        expect(IndexingService.deleteProduct).toHaveBeenCalledExactlyOnceWith(accountId, 100);
    });

    it.each([true, false])('restores through scoped upserts retaining local overrides (incremental=%s)', async incremental => {
        vi.spyOn(productSync as any, 'getLastSync').mockResolvedValue(undefined);
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 100, name: 'Restored', type: 'variable', status: 'publish' }], totalPages: 1 }).mockResolvedValue({ data: [], totalPages: 1 }), getProductVariations: vi.fn().mockResolvedValue([{ id: 101, sku: 'V' }]) };
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'original-uuid', wooId: 100 }]);
        mockPrisma.wooProduct.upsert.mockResolvedValue({ id: 'original-uuid', wooId: 100 });
        await (productSync as any).sync(woo, accountId, incremental);
        const parent = mockPrisma.wooProduct.upsert.mock.calls[0][0];
        expect(parent.where).toEqual({ accountId_wooId: { accountId, wooId: 100 } });
        expect(parent.update.status).toBe('publish');
        expect(parent.update).not.toHaveProperty('cogs');
        const variant = mockPrisma.productVariation.upsert.mock.calls[0][0];
        expect(variant.where).toEqual({ productId_wooId: { productId: 'original-uuid', wooId: 101 } });
        expect(variant.update).not.toHaveProperty('cogs');
        expect(mockPrisma.bOMItem.updateMany).not.toHaveBeenCalled();
    });

    it.each(['trash', 'publish', 'private', 'proxy-404', 'definite-404'])('handles authoritative full-sync candidate %s safely', async outcome => {
        const woo = { getProducts: vi.fn().mockResolvedValue({ data: [], totalPages: 1 }), getProduct: vi.fn() };
        mockPrisma.wooProduct.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'stale', wooId: 100 }]);
        if (outcome === 'proxy-404') woo.getProduct.mockRejectedValue(new Error('proxy 404'));
        else if (outcome === 'definite-404') {
            woo.getProduct.mockRejectedValue({ response: { status: 404, data: { code: 'woocommerce_rest_product_invalid_id' } } });
        } else woo.getProduct.mockResolvedValue({ id: 100, status: outcome });
        const run = (productSync as any).sync(woo, accountId, false);
        if (outcome === 'proxy-404') await expect(run).rejects.toThrow();
        else await run;
        expect(mockPrisma.wooProduct.deleteMany).not.toHaveBeenCalled();
        expect(woo.getProduct).toHaveBeenCalledWith(100, { bypassCache: true });
    });

    it('does not reconcile variations when enumeration fails', async () => {
        const remoteProduct = {
            id: 999,
            name: 'Variable Product',
            type: 'variable',
            price: '10.00'
        };
        const persistedProduct = {
            id: 'product-db-1',
            accountId,
            wooId: 999,
            name: remoteProduct.name,
            rawData: remoteProduct,
            seoData: null
        };
        const mockWooService = {
            getProducts: vi.fn().mockResolvedValue({
                data: [remoteProduct],
                totalPages: 1
            }),
            getProductVariations: vi.fn().mockRejectedValue(new Error('store unavailable'))
        };
        mockPrisma.account.findUnique.mockResolvedValue(null);
        mockPrisma.wooProduct.upsert.mockResolvedValue(persistedProduct);
        mockPrisma.wooProduct.findMany.mockResolvedValue([persistedProduct]);

        await expect(
            (productSync as any).sync(mockWooService as any, accountId, false)
        ).rejects.toThrow('checkpoint was not advanced');

        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
    });

    it.each([true, false])('accepts no-image variations and reconciles exact IDs (incremental=%s)', async incremental => {
        vi.spyOn(productSync as any, 'getLastSync').mockResolvedValue(undefined);
        const woo = {
            getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 35270, name: 'Variable', type: 'variable' }], totalPages: 1 })
                .mockResolvedValue({ data: [], totalPages: 0 }),
            getProductVariations: vi.fn().mockResolvedValue([{ id: 35273, image: null }, { id: 35272, image: null }]),
        };
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 35270 }]);
        await (productSync as any).sync(woo, accountId, incremental);
        expect(mockPrisma.productVariation.upsert).toHaveBeenCalledTimes(2);
        for (const [args] of mockPrisma.productVariation.upsert.mock.calls) {
            expect(args.update).toMatchObject({ images: [], rawData: { image: null } });
            expect(args.create).toMatchObject({ images: [], rawData: { image: null } });
        }
        expect(woo.getProductVariations).toHaveBeenCalledWith(35270, { bypassCache: true });
        expect(mockPrisma.productVariation.updateMany).toHaveBeenCalledWith({ where: {
            productId: 'p', product: { accountId }, wooId: { notIn: [35273, 35272] }, deliveryActive: true,
        }, data: { deliveryActive: false } });
    });

    it('retains parent-declared variations omitted by an otherwise successful listing', async () => {
        const woo = {
            getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 60889, name: 'Variable', type: 'variable', variations: [11, 12] }], totalPages: 1 }),
            getProductVariations: vi.fn().mockResolvedValue([{ id: 11, status: 'private', image: null }]),
        };
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 60889 }]);
        await expect((productSync as any).sync(woo, accountId, false)).rejects.toThrow('checkpoint was not advanced');
        expect(mockPrisma.productVariation.upsert).not.toHaveBeenCalled();
        expect(mockPrisma.wooProduct.upsert).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
    });

    it.each(['empty', 'error', 'repeat'])('commits only complete per-parent observations, then fails the checkpoint on %s catalogue pagination', async failure => {
        const first = { data: [{ id: 10, name: 'Variable', type: 'variable' }], totalPages: 2, total: 2 };
        const woo = { getProducts: vi.fn().mockResolvedValueOnce(first), getProductVariations: vi.fn().mockResolvedValue([]) };
        if (failure === 'error') woo.getProducts.mockRejectedValueOnce(new Error('unavailable'));
        else woo.getProducts.mockResolvedValueOnce(failure === 'repeat' ? first : { data: [], totalPages: 2, total: 2 });
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 10 }]);
        await expect((productSync as any).sync(woo, accountId, false)).rejects.toThrow();
        expect(mockPrisma.productVariation.updateMany).toHaveBeenCalledWith({ where: { productId: 'p', product: { accountId }, wooId: { notIn: [] }, deliveryActive: true }, data: { deliveryActive: false } });
        expect(mockPrisma.wooProduct.deleteMany).not.toHaveBeenCalled();
        expect(mockPrisma.wooProduct.upsert).toHaveBeenCalledTimes(1);
    });

    it.each([
        { response: { status: 404, data: { code: 'rest_no_route' } } },
        { response: { status: 404, data: {} } },
        { response: { status: 403, data: { code: 'woocommerce_rest_product_invalid_id' } } },
    ])('does not treat ambiguous/auth errors as confirmed missing', async error => {
        const woo = { getProducts: vi.fn().mockResolvedValue({ data: [], totalPages: 0 }), getProduct: vi.fn().mockRejectedValue(error) };
        mockPrisma.wooProduct.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'stale', wooId: 100 }]);
        await expect((productSync as any).sync(woo, accountId, false)).rejects.toEqual(error);
        expect(mockPrisma.wooProduct.deleteMany).not.toHaveBeenCalled();
        expect(Logger.warn).not.toHaveBeenCalledWith('Confirmed missing Woo product retained: catalogue retirement required', expect.anything());
    });

    it('does not write or emit a rejected stale variable snapshot', async () => {
        mockPrisma.wooProduct.findUnique.mockResolvedValue({ id: 'p', deliveryMembershipObservedAt: new Date('2099-01-01') });
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 10, name: 'Stale', type: 'variable', variations: [11, 99] }], totalPages: 1 })
            .mockResolvedValue({ data: [], totalPages: 0 }), getProductVariations: vi.fn().mockResolvedValue([{ id: 11, stock_quantity: 999 }, { id: 99 }]) };
        expect(await (productSync as any).sync(woo, accountId, false)).toMatchObject({ itemsProcessed: 0 });
        expect(mockPrisma.wooProduct.upsert).not.toHaveBeenCalled();
        expect(mockPrisma.wooProduct.update).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.upsert).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.updateMany).not.toHaveBeenCalled();
        expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(EventBus.emit).not.toHaveBeenCalled();
        expect(IndexingService.bulkIndexProducts).toHaveBeenCalledWith(accountId, []);
    });

    it('continues independent valid parents without writing valid siblings of a quarantined parent', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 10 }]);
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [
            { id: 20, name: 'Quarantined', type: 'variable' }, { id: 10, name: 'Valid', type: 'simple' },
        ], totalPages: 1 }).mockResolvedValue({ data: [], totalPages: 0 }),
            getProductVariations: vi.fn().mockResolvedValue([{ id: 21, stock_quantity: 999 }, { id: 22, image: 'invalid' }]) };
        expect(await (productSync as any).sync(woo, accountId, false)).toMatchObject({ itemsProcessed: 1 });
        expect(mockPrisma.wooProduct.upsert).toHaveBeenCalledOnce();
        expect(mockPrisma.wooProduct.upsert.mock.calls[0][0].where).toEqual({ accountId_wooId: { accountId, wooId: 10 } });
        expect(mockPrisma.productVariation.upsert).not.toHaveBeenCalled();
        expect(EventBus.emit).toHaveBeenCalledExactlyOnceWith('product.synced', expect.objectContaining({ product: expect.objectContaining({ id: 10 }) }));
    });

    it('quarantines malformed variations without failing or reconciling the parent', async () => {
        const remoteProduct = {
            id: 93144,
            name: 'Variable Product',
            type: 'variable',
            price: '10.00'
        };
        const persistedProduct = {
            id: 'product-db-93144',
            accountId,
            wooId: 93144,
            name: remoteProduct.name,
            rawData: remoteProduct,
            seoData: null
        };
        const mockWooService = {
            getProducts: vi.fn()
                .mockResolvedValueOnce({ data: [remoteProduct], totalPages: 1 })
                .mockResolvedValue({ data: [], totalPages: 0 }),
            getProductVariations: vi.fn().mockResolvedValue([
                { id: 501, sku: 'VALID', price: '10.00' },
                { id: 'invalid-id', sku: 'INVALID', price: '10.00' }
            ])
        };
        mockPrisma.account.findUnique.mockResolvedValue(null);
        mockPrisma.wooProduct.upsert.mockResolvedValue(persistedProduct);
        mockPrisma.wooProduct.findMany.mockResolvedValue([persistedProduct]);

        await expect(
            (productSync as any).sync(mockWooService as any, accountId, false, undefined, 'sync-test')
        ).resolves.toMatchObject({ itemsProcessed: 0 });

        expect(mockPrisma.productVariation.upsert).not.toHaveBeenCalled();
        expect(mockPrisma.wooProduct.upsert).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.updateMany).not.toHaveBeenCalled();
        expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
        expect(Logger.warn).toHaveBeenCalledWith(
            'Quarantined WooCommerce parent snapshot; no source changes applied',
            expect.objectContaining({
                accountId,
                productId: 93144,
                invalidCount: 1,
                failures: [expect.objectContaining({
                    variationId: null,
                    issues: expect.arrayContaining([
                        expect.objectContaining({ path: 'id' })
                    ])
                })]
            })
        );
    });
});
