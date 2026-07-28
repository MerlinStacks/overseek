import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    search: vi.fn(),
    wooProductFindMany: vi.fn()
}));

vi.mock('../utils/elastic', () => ({
    esClient: { search: mocks.search }
}));

vi.mock('../utils/prisma', () => ({
    prisma: {
        wooProduct: { findMany: mocks.wooProductFindMany },
        productVariation: { findMany: vi.fn() }
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
});
