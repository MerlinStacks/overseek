
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductSync } from '../ProductSync';
import { IndexingService } from '../../search/IndexingService';

// Mock dependencies
const mockPrisma = vi.hoisted(() => ({
    wooProduct: {
        findMany: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        update: vi.fn(),
    },
    $transaction: vi.fn(),
}));

// Fix path to point to src/utils/prisma from src/services/sync/__tests__
vi.mock('../../../utils/prisma', () => ({
    prisma: mockPrisma
}));

vi.mock('../../woo', () => ({
    WooService: vi.fn()
}));

vi.mock('../../search/IndexingService', () => ({
    IndexingService: {
        deleteProduct: vi.fn().mockResolvedValue(undefined),
        indexProduct: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../utils/logger', () => ({
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
    });

    it('should use deleteMany for reconciliation', async () => {
        // Setup mock WooService to return one product (so reconciliation triggers, but it's different from local ones)
        const mockWooService = {
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
        mockPrisma.wooProduct.delete.mockResolvedValue({});
        mockPrisma.$transaction.mockResolvedValue([]);

        // Run sync (non-incremental to trigger reconciliation)
        // Accessing protected member via any cast
        await (productSync as any).sync(mockWooService as any, accountId, false);

        // Verification
        console.log('delete calls:', mockPrisma.wooProduct.delete.mock.calls.length);
        console.log('deleteMany calls:', mockPrisma.wooProduct.deleteMany.mock.calls.length);

        // Assert optimized behavior
        expect(mockPrisma.wooProduct.delete).toHaveBeenCalledTimes(0);
        expect(mockPrisma.wooProduct.deleteMany).toHaveBeenCalledTimes(1);

        // Verify deleteMany args
        const deleteManyArgs = mockPrisma.wooProduct.deleteMany.mock.calls[0][0];
        expect(deleteManyArgs).toEqual({
            where: { id: { in: expect.any(Array) } }
        });
        expect(deleteManyArgs.where.id.in).toHaveLength(productCount);

        // Verify IndexingService is still called for each product
        expect(IndexingService.deleteProduct).toHaveBeenCalledTimes(productCount);
    });
});
