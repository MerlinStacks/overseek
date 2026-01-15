
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingService } from './EmbeddingService';
import { prisma } from '../utils/prisma';

// Mock dependencies
vi.mock('../utils/prisma', () => ({
    prisma: {
        account: {
            findUnique: vi.fn()
        },
        wooProduct: {
            findUnique: vi.fn()
        },
        $queryRaw: vi.fn(),
        $executeRaw: vi.fn()
    }
}));

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('EmbeddingService Benchmark', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default mocks
        (prisma.account.findUnique as any).mockResolvedValue({
            openRouterApiKey: 'test-key',
            embeddingModel: 'test-model'
        });

        // Smart mock for batching
        fetchMock.mockImplementation(async (url, options) => {
            const body = JSON.parse(options.body);
            const input = body.input;
            const count = Array.isArray(input) ? input.length : 1;

            return {
                ok: true,
                json: async () => ({
                    data: Array.from({ length: count }, (_, i) => ({
                        embedding: Array(1536).fill(0.1),
                        index: i
                    }))
                })
            };
        });
    });

    it('benchmarks batchUpdateEmbeddings', async () => {
        const productCount = 5;

        // Mock products
        const products = Array.from({ length: productCount }, (_, i) => ({
            id: `prod-${i}`,
            rawData: {
                name: `Product ${i}`,
                sku: `SKU-${i}`,
                description: `Description for product ${i}`,
                categories: [{ name: 'Cat1' }],
                tags: [{ name: 'Tag1' }]
            }
        }));

        (prisma.$queryRaw as any).mockResolvedValue(products);

        console.time('batchUpdateEmbeddings');
        const updated = await EmbeddingService.batchUpdateEmbeddings('test-account', productCount);
        console.timeEnd('batchUpdateEmbeddings');

        expect(updated).toBe(productCount);

        // Verify we made API calls
        console.log(`Fetch called ${fetchMock.mock.calls.length} times`);

        // Expect only 1 fetch call for the batch
        expect(fetchMock.mock.calls.length).toBe(1);
    }, 5000);
});
