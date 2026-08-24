import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    search: vi.fn(),
    wooProductFindMany: vi.fn(),
    wooProductCount: vi.fn(),
    variationFindMany: vi.fn()
}));

vi.mock('../utils/elastic', () => ({
    esClient: { search: mocks.search }
}));

vi.mock('../utils/prisma', () => ({
    prisma: {
        wooProduct: {
            findMany: mocks.wooProductFindMany,
            count: mocks.wooProductCount
        },
        productVariation: { findMany: mocks.variationFindMany }
    }
}));

vi.mock('../utils/logger', () => ({
    Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { ProductSearchService } from './productSearch';

describe('ProductSearchService sorting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.search.mockResolvedValue({
            hits: {
                hits: [{ _id: 'account-1_1', _source: { id: 'product-1', wooId: 1, name: 'Alpha' } }],
                total: { value: 1 }
            }
        });
        mocks.wooProductFindMany.mockResolvedValue([]);
        mocks.wooProductCount.mockResolvedValue(0);
        mocks.variationFindMany.mockResolvedValue([]);
    });

    it('sorts names using the normalized keyword field', async () => {
        await ProductSearchService.searchProducts('account-1', '', 1, 20, 'name', 'asc');

        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({
            sort: [
                { nameSort: { order: 'asc', unmapped_type: 'keyword' } },
                { wooId: { order: 'asc', unmapped_type: 'integer' } }
            ]
        }));
    });

    it('searches Elasticsearch by an exact WooCommerce product ID', async () => {
        await ProductSearchService.searchProducts('account-1', '93144');

        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({
            query: {
                bool: {
                    must: expect.arrayContaining([
                        expect.objectContaining({
                            bool: expect.objectContaining({
                                should: expect.arrayContaining([
                                    { term: { wooId: { value: 93144, boost: 20 } } }
                                ])
                            })
                        })
                    ])
                }
            }
        }));
    });

    it('searches the database by product and variation WooCommerce IDs', async () => {
        mocks.variationFindMany.mockResolvedValue([{ productId: 'parent-product' }]);

        await ProductSearchService.searchProductsFromDB('account-1', '93144', 1, 20);

        expect(mocks.variationFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                product: { accountId: 'account-1' },
                OR: [
                    { sku: { contains: '93144', mode: 'insensitive' } },
                    { wooId: 93144 }
                ]
            }
        }));
        expect(mocks.wooProductCount).toHaveBeenCalledWith({
            where: {
                accountId: 'account-1',
                OR: [
                    { wooId: 93144 },
                    { name: { contains: '93144', mode: 'insensitive' } },
                    { sku: { contains: '93144', mode: 'insensitive' } },
                    { id: { in: ['parent-product'] } }
                ]
            }
        });
    });
});
