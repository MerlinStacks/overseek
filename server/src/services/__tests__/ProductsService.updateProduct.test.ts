import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductsService } from '../products';
import { prisma } from '../../utils/prisma';

// Mock prisma
vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooProduct: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        productVariation: {
            upsert: vi.fn(),
        }
    }
}));

// Mock WooService - updateProductVariation is called for variations, not updateProduct
const mockUpdateProductVariation = vi.fn();
vi.mock('../woo', () => ({
    WooService: {
        forAccount: vi.fn(() => ({
            updateProductVariation: mockUpdateProductVariation
        }))
    }
}));

// Mock Logger to suppress output
vi.mock('../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock Redis — variation sync clears 404 tracking keys on success
vi.mock('../../utils/redis', () => ({
    redisClient: {
        del: vi.fn().mockResolvedValue(0),
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockResolvedValue('OK'),
    }
}));

describe('ProductsService.updateProduct Performance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('processes variations in batches (fast)', async () => {
        const accountId = 'acc_123';
        const wooId = 123;
        const variations = Array.from({ length: 10 }, (_, i) => ({
            id: 1000 + i,
            sku: `VAR-${i}`,
            price: '10.00',
            salePrice: '9.00',
            stockStatus: 'instock'
        }));

        const data = {
            name: 'Test Product',
            variations
        };

        (prisma.wooProduct.findUnique as any).mockResolvedValue({
            id: 'local_123',
            rawData: {}
        });
        (prisma.wooProduct.update as any).mockResolvedValue({
            id: 'local_123'
        });
        (prisma.productVariation.upsert as any).mockResolvedValue({});

        // Simulate 100ms latency per variation update
        mockUpdateProductVariation.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return {};
        });

        const start = Date.now();
        await ProductsService.updateProduct(accountId, wooId, data);
        const end = Date.now();
        const duration = end - start;

        console.log(`Duration (Batched, size=5): ${duration}ms`);

        // Batched (5 at a time): 10 variations = 2 batches × 100ms ≈ 200ms
        expect(duration).toBeLessThan(500);
        expect(mockUpdateProductVariation).toHaveBeenCalledTimes(10);
    });
});

