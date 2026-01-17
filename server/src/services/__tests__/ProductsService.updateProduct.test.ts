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
        },
    }
}));

// Mock WooService
const mockUpdateProduct = vi.fn();
vi.mock('../woo', () => ({
    WooService: {
        forAccount: vi.fn(() => ({
            updateProduct: mockUpdateProduct
        }))
    }
}));

describe('ProductsService.updateProduct Performance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('processes variations in parallel (fast)', async () => {
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

        // Simulate 100ms latency per variation update
        mockUpdateProduct.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return {};
        });

        const start = Date.now();
        await ProductsService.updateProduct(accountId, wooId, data);
        const end = Date.now();
        const duration = end - start;

        console.log(`Duration (Parallel): ${duration}ms`);

        // Should be close to 100ms (e.g. < 300ms overhead)
        expect(duration).toBeLessThan(300);
        expect(mockUpdateProduct).toHaveBeenCalledTimes(10);
    });
});
