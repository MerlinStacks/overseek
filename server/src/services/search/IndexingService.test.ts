import { beforeEach, describe, expect, it, vi } from 'vitest';

const elastic = vi.hoisted(() => ({
    bulk: vi.fn(), delete: vi.fn(), index: vi.fn()
}));

vi.mock('../../utils/elastic', () => ({
    esClient: {
        bulk: elastic.bulk, delete: elastic.delete, index: elastic.index
    },
    isElasticsearchAvailable: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

import { IndexingService } from './IndexingService';

describe('IndexingService product document IDs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        elastic.bulk.mockResolvedValue({ errors: false, items: [] });
    });

    it('uses wooId for Elasticsearch _id while preserving the internal id', async () => {
        await IndexingService.bulkIndexProducts('account-1', [{
            id: 'internal-product-uuid',
            wooId: 42,
            name: 'Product',
            rawData: {},
            variations: [{ id: 'internal-variation-uuid', wooId: 84 }]
        }]);

        const operations = elastic.bulk.mock.calls[0][0].operations;
        expect(operations[0]).toEqual({
            index: { _index: 'products', _id: 'account-1_42' }
        });
        expect(operations[1]).toMatchObject({
            id: 'internal-product-uuid',
            wooId: 42,
            nameSort: 'product',
            variations: [{ id: 84 }]
        });
    });

    it('propagates deletion failures but treats an absent document as successful', async () => {
        elastic.delete.mockRejectedValueOnce(new Error('offline'));
        await expect(IndexingService.deleteProduct('a', 42)).rejects.toThrow('offline');
        elastic.delete.mockRejectedValueOnce({ meta: { statusCode: 404 } });
        await expect(IndexingService.deleteProduct('a', 42)).resolves.toBeUndefined();
        expect(elastic.delete).toHaveBeenCalledWith({ index: 'products', id: 'a_42', refresh: true });
    });

    it('removes trash rather than reindexing it, including bulk rebuilds', async () => {
        const trash = { id: 'uuid', wooId: 42, status: 'trash', rawData: {} };
        await IndexingService.indexProduct('a', trash);
        await IndexingService.bulkIndexProducts('a', [trash, { id: 'live', wooId: 43 }]);
        expect(elastic.index).not.toHaveBeenCalled();
        expect(elastic.delete).toHaveBeenCalledTimes(2);
        expect(elastic.bulk.mock.calls[0][0].operations).toHaveLength(2);
        expect(elastic.bulk.mock.calls[0][0].operations[1].wooId).toBe(43);
    });
});
