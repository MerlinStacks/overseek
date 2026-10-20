import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Prisma
const mockPrisma = vi.hoisted(() => ({
    account: {
        findUnique: vi.fn(),
    },
    wooProduct: {
        findUnique: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
}));

vi.mock('../utils/prisma', () => ({
    prisma: mockPrisma
}));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Mock fetch
const mockFetch = vi.fn();

let EmbeddingService: typeof import('./EmbeddingService').EmbeddingService;

describe('EmbeddingService Benchmark', () => {
    const accountId = 'acc_123';
    const productId = 'prod_123';

    beforeEach(async () => {
        vi.resetAllMocks();
        vi.resetModules();
        EmbeddingService = (await import('./EmbeddingService')).EmbeddingService;
        vi.stubGlobal('fetch', mockFetch);
        mockPrisma.$queryRaw.mockResolvedValue([{ exists: true }]);

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

        mockFetch.mockImplementation(async () => new Response(JSON.stringify({
            data: [{ index: 0, embedding: Array(1536).fill(0.1) }]
        }), { headers: { 'content-type': 'application/json' } }));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

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

        for (let i = 0; i < iterations; i++) {
            // Simulate having the product available (as in ProductSync)
            const product = {
                id: productId,
                rawData: { name: 'Test Product', description: 'Test Description' }
            };

            await EmbeddingService.updateProductEmbedding(productId, accountId, account, product);
        }

        const accountCalls = mockPrisma.account.findUnique.mock.calls.length;
        const productCalls = mockPrisma.wooProduct.findUnique.mock.calls.length;

        // We expect 0 calls because we passed the data
        expect(accountCalls).toBe(0);
        expect(productCalls).toBe(0);
        expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledTimes(iterations);
        expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(iterations);
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
        expect(options.headers.Authorization).toBe('Bearer sk-test-key');
        expect(JSON.parse(options.body)).toEqual({ model: 'openai/text-embedding-3-small', input: ['Test Product Test Description'] });
        expect(mockPrisma.$executeRaw.mock.calls[0].slice(1)).toEqual([Array(1536).fill(0.1), productId]);
    });

    it('loads account and product when preloaded data is absent', async () => {
        await EmbeddingService.updateProductEmbedding(productId, accountId);
        expect(mockPrisma.account.findUnique).toHaveBeenCalledWith({ where: { id: accountId }, select: { openRouterApiKey: true, embeddingModel: true } });
        expect(mockPrisma.wooProduct.findUnique).toHaveBeenCalledWith({ where: { id: productId } });
        expect(mockFetch).toHaveBeenCalledOnce();
        expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
    });

    it('explicitly skips generation when the embedding column is unavailable', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ exists: false }]);
        await EmbeddingService.updateProductEmbedding(productId, accountId);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('does not write an embedding when the provider rejects the request', async () => {
        mockFetch.mockImplementation(async () => new Response('{"error":{"message":"Provider rejected request"}}', {
            status: 429, headers: { 'content-type': 'application/json' }
        }));
        await expect(EmbeddingService.updateProductEmbedding(productId, accountId)).rejects.toThrow('Provider rejected request');
        expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });
});
