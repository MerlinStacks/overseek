import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductSync } from '../ProductSync';
import { IndexingService } from '../../search/IndexingService';
import { Logger } from '../../../utils/logger';

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
    },
    productVariation: {
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
        mockPrisma.wooProduct.count.mockResolvedValue(0);
        mockPrisma.wooProduct.findUnique.mockResolvedValue({ id: 'stale', wooId: 100, rawData: {} });
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
        expect(mockPrisma.productVariation.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { productId: 'p' } });
        expect(mockPrisma.bOMItem.updateMany).toHaveBeenNthCalledWith(2, {
            where: { bom: { productId: 'p', variationId: { not: 0 } } },
            data: { isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' }
        });
        expect(mockPrisma.bOM.deleteMany).not.toHaveBeenCalled();
        expect(woo.getProductVariations).not.toHaveBeenCalled();
        expect(mockPrisma.productVariation.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(IndexingService.bulkIndexProducts).mock.invocationCallOrder[0]);
    });

    it('does not delete variations for a missing type even in full reconciliation', async () => {
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 10, name: 'Unknown' }], totalPages: 1 })
            .mockResolvedValue({ data: [], totalPages: 1 }) };
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'p', wooId: 10 }]);
        mockPrisma.wooProduct.count.mockResolvedValue(0);
        await (productSync as any).sync(woo, accountId, false);
        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
    });

    it.each(['variations', 'recipes'])('fails the sync checkpoint and skips indexing when simple %s cleanup fails', async stage => {
        vi.spyOn(productSync as any, 'getLastSync').mockResolvedValue(undefined);
        const woo = { getProducts: vi.fn().mockResolvedValueOnce({ data: [{ id: 10, name: 'Simple', type: 'simple' }], totalPages: 1 })
            .mockResolvedValue({ data: [], totalPages: 1 }) };
        mockPrisma.wooProduct.upsert.mockResolvedValue({ id: 'p', wooId: 10 });
        mockPrisma.wooProduct.findMany.mockResolvedValue([]);
        if (stage === 'recipes') {
            mockPrisma.bOMItem.updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error('cleanup failed'));
        } else {
            mockPrisma.productVariation.deleteMany.mockRejectedValueOnce(new Error('cleanup failed'));
        }
        await expect((productSync as any).sync(woo, accountId, true)).rejects.toThrow('checkpoint was not advanced');
        expect(IndexingService.bulkIndexProducts).toHaveBeenCalledWith(accountId, []);
        expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(expect.any(String), accountId, [10]);
        if (stage === 'recipes') {
            expect(mockPrisma.bOMItem.updateMany).toHaveBeenCalledTimes(2);
            expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
        }
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

    it('confirms missing products before transactional reconciliation', async () => {
        // Setup mock WooService to return one product (so reconciliation triggers, but it's different from local ones)
        const mockWooService = {
            getProduct: vi.fn().mockRejectedValue({ response: { status: 404, data: { code: 'woocommerce_rest_product_invalid_id' } } }),
            getProducts: vi.fn()
                .mockResolvedValueOnce({
                    data: [{ id: 999, name: 'Safe Product', price: '10.00' }],
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
        expect(mockPrisma.wooProduct.deleteMany).toHaveBeenCalledTimes(productCount);

        // Verify deleteMany args
        const deleteManyArgs = mockPrisma.wooProduct.deleteMany.mock.calls[0][0];
        expect(deleteManyArgs).toEqual({
            where: {
                accountId,
                id: 'stale',
                wooId: 100
            }
        });

        // Verify IndexingService is still called for each product
        expect(IndexingService.deleteProduct).toHaveBeenCalledTimes(productCount);
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

    it.each(['trash', 'publish', 'proxy-404', 'search-failure'])('handles authoritative full-sync candidate %s safely', async outcome => {
        const woo = { getProducts: vi.fn().mockResolvedValue({ data: [], totalPages: 1 }), getProduct: vi.fn() };
        mockPrisma.wooProduct.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ id: 'stale', wooId: 100 }]);
        if (outcome === 'proxy-404') woo.getProduct.mockRejectedValue(new Error('proxy 404'));
        else if (outcome === 'search-failure') {
            woo.getProduct.mockRejectedValue({ response: { status: 404, data: { code: 'woocommerce_rest_product_invalid_id' } } });
            vi.mocked(IndexingService.deleteProduct).mockRejectedValueOnce(new Error('search down'));
        } else woo.getProduct.mockResolvedValue({ id: 100, status: outcome });
        const run = (productSync as any).sync(woo, accountId, false);
        if (outcome === 'proxy-404' || outcome === 'search-failure') await expect(run).rejects.toThrow();
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
        ).resolves.toMatchObject({ itemsProcessed: 1 });

        expect(mockPrisma.productVariation.upsert).toHaveBeenCalledTimes(1);
        expect(mockPrisma.productVariation.deleteMany).not.toHaveBeenCalled();
        expect(Logger.warn).toHaveBeenCalledWith(
            'Skipped invalid WooCommerce variation payloads',
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
