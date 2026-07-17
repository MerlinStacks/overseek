import { beforeEach, describe, expect, it, vi } from 'vitest';

const elastic = vi.hoisted(() => ({
    bulk: vi.fn()
}));

vi.mock('../../utils/elastic', () => ({
    esClient: {
        bulk: elastic.bulk
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
            variations: [{ id: 84 }]
        });
    });
});
