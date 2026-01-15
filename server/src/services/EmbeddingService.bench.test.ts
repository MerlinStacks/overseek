import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
const mockPrisma = vi.hoisted(() => ({
    account: {
        findUnique: vi.fn(),
    },
    wooProduct: {
        findUnique: vi.fn(),
    },
    $executeRaw: vi.fn(),
}));

vi.mock('../utils/prisma', () => ({
    prisma: mockPrisma
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { EmbeddingService } from './EmbeddingService';

describe('EmbeddingService Benchmark', () => {
    const accountId = 'acc_123';
    const productId = 'prod_123';

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default mock responses
        mockPrisma.account.findUnique.mockResolvedValue({
            id: accountId,
            openRouterApiKey: 'sk-test-key',
            embeddingModel: 'openai/text-embedding-3-small'
        });

        mockPrisma.wooProduct.findUnique.mockResolvedValue({
            id: productId,
            name: 'Test Product',
            rawData: { name: 'Test Product', description: 'Test Description' }
        });

        mockPrisma.$executeRaw.mockResolvedValue(1);

        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ data: [{ embedding: Array(1536).fill(0.1) }] })
        });
    });

    it('measures DB calls for updateProductEmbedding with optimization', async () => {
        const iterations = 10;

        // Simulate fetching account once (as done in ProductSync)
        const account = await mockPrisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, embeddingModel: true }
        });

        // Reset counts after initial fetch
        mockPrisma.account.findUnique.mockClear();
        mockPrisma.wooProduct.findUnique.mockClear();

        console.time('Optimized Benchmark');
        for (let i = 0; i < iterations; i++) {
            // Simulate having the product available (as in ProductSync)
            const product = {
                id: productId,
                rawData: { name: 'Test Product', description: 'Test Description' }
            };

            await EmbeddingService.updateProductEmbedding(productId, accountId, account, product);
        }
        console.timeEnd('Optimized Benchmark');

        const accountCalls = mockPrisma.account.findUnique.mock.calls.length;
        const productCalls = mockPrisma.wooProduct.findUnique.mock.calls.length;

        console.log(`Optimized DB Calls: Account=${accountCalls}, Product=${productCalls}`);

        // We expect 0 calls because we passed the data
        expect(accountCalls).toBe(0);
        expect(productCalls).toBe(0);
    });
});
