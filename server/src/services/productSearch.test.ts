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
import type { ProductSearchFilters } from './productSearch';
const active = { OR: [{ status: null }, { status: { not: 'trash' } }] };

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
                product: { accountId: 'account-1', ...active },
                OR: [
                    { sku: { contains: '93144', mode: 'insensitive' } },
                    { wooId: 93144 }
                ]
            }
        }));
        expect(mocks.wooProductCount).toHaveBeenCalledWith({
            where: {
                accountId: 'account-1',
                AND: [active],
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

describe('ProductSearchService filters', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.wooProductFindMany.mockResolvedValue([]);
        mocks.wooProductCount.mockResolvedValue(0);
        mocks.variationFindMany.mockResolvedValue([]);
    });

    const cases: [ProductSearchFilters, unknown][] = [
        ...(['instock', 'outofstock', 'onbackorder'] as const).map(stockStatus => [
            { stockStatus }, { stockStatus }
        ] as [ProductSearchFilters, unknown]),
        ...(['publish', 'private', 'draft', 'pending', 'future'] as const).map(status => [
            { status }, { rawData: { path: ['status'], equals: status } }
        ] as [ProductSearchFilters, unknown]),
        [{ category: 12 }, { rawData: { path: ['categories'], array_contains: [{ id: 12 }] } }],
        [{ tag: 34 }, { OR: [{ rawData: { path: ['tags'], array_contains: [{ id: 34 }] } }] }],
        [{ tag: [34, 56] }, { OR: [
            { rawData: { path: ['tags'], array_contains: [{ id: 34 }] } },
            { rawData: { path: ['tags'], array_contains: [{ id: 56 }] } }
        ] }]
    ];

    it.each(cases)('uses tenant-scoped DB filtering and bypasses ES for %j', async (filters, condition) => {
        const result = await ProductSearchService.searchProducts('account-2', '', 1, 20, null, 'asc', filters);

        const where = { accountId: 'account-2', AND: [active, condition] };
        expect(mocks.wooProductCount).toHaveBeenCalledWith({ where });
        expect(mocks.wooProductFindMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 0, take: 20 }));
        expect(result).toEqual({ products: [], total: 0, page: 1, totalPages: 0 });
        expect(mocks.search).not.toHaveBeenCalled();
    });

    it.each(['BLUE-SKU', '93144'])('conjoins all filters with query and variant matches before count and pagination (%s)', async query => {
        mocks.variationFindMany.mockResolvedValueOnce([{ productId: 'matching-parent' }]);
        mocks.wooProductCount.mockResolvedValue(5);
        mocks.wooProductFindMany.mockResolvedValueOnce([
            { id: 'matching-parent', name: 'Parent', wooId: 10, rawData: { type: 'variable' } }
        ]);

        const result = await ProductSearchService.searchProducts(
            'account-1', query, 2, 2, 'price', 'desc', { status: 'private', category: 12, tag: [34, 56], stockStatus: 'onbackorder' }
        );

        const where = {
            accountId: 'account-1',
            AND: [
                active,
                { rawData: { path: ['status'], equals: 'private' } },
                { rawData: { path: ['categories'], array_contains: [{ id: 12 }] } },
                { OR: [
                    { rawData: { path: ['tags'], array_contains: [{ id: 34 }] } },
                    { rawData: { path: ['tags'], array_contains: [{ id: 56 }] } }
                ] },
                { stockStatus: 'onbackorder' }
            ],
            OR: [
                ...(query === '93144' ? [{ wooId: 93144 }] : []),
                { name: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
                { id: { in: ['matching-parent'] } }
            ]
        };
        expect(mocks.variationFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                product: { accountId: 'account-1', ...active },
                OR: [
                    { sku: { contains: query, mode: 'insensitive' } },
                    ...(query === '93144' ? [{ wooId: 93144 }] : [])
                ]
            }
        }));
        expect(mocks.wooProductCount).toHaveBeenCalledWith({ where });
        expect(mocks.wooProductFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where, skip: 2, take: 2, orderBy: { price: 'desc' }
        }));
        expect(result).toEqual({
            products: [expect.objectContaining({ id: 'matching-parent' })], total: 5, page: 2, totalPages: 3
        });
        expect(mocks.search).not.toHaveBeenCalled();
    });

    it('keeps an empty filter object on the Elasticsearch path', async () => {
        mocks.search.mockResolvedValue({ hits: { hits: [], total: { value: 0 } } });
        await ProductSearchService.searchProducts('account-1', '', 1, 20, null, 'asc', {});
        expect(mocks.search).toHaveBeenCalledOnce();
        expect(mocks.wooProductCount).toHaveBeenCalledWith({ where: { accountId: 'account-1', AND: [active] } });
    });

    it('filters stale ES hits and scopes supplemental SKU/attribute searches to active parents', async () => {
        mocks.search.mockResolvedValue({ hits: { hits: [{ _source: { id: 'trashed', wooId: 7 } }], total: { value: 1 } } });
        const result = await ProductSearchService.searchProducts('account-1', 'blue');
        expect(result.products).toEqual([]);
        expect(mocks.wooProductFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account-1', id: { in: ['trashed'] }, ...active } }));
        expect(mocks.variationFindMany).toHaveBeenCalledTimes(2);
        for (const [args] of mocks.variationFindMany.mock.calls) expect(args.where.product).toEqual({ accountId: 'account-1', ...active });
    });

    it('does not surface legacy ES hits without a verifiable local identity', async () => {
        mocks.search.mockResolvedValue({ hits: { hits: [{ _source: { id: 7, wooId: 7 } }], total: { value: 1 } } });
        expect((await ProductSearchService.searchProducts('account-1')).products).toEqual([]);
    });
});
