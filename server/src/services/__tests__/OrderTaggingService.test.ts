import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderTaggingService } from '../OrderTaggingService';
import { prisma } from '../../utils/prisma';

// Mock prisma
vi.mock('../../utils/prisma', () => ({
    prisma: {
        account: {
            findUnique: vi.fn(),
            update: vi.fn()
        },
        wooProduct: {
            findMany: vi.fn()
        }
    }
}));

// Mock Logger to avoid cluttering output
vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

describe('OrderTaggingService Performance', () => {
    const accountId = 'acc_123';
    const mockMappings = {
        orderTagMappings: [
            { productTag: 'Blue', orderTag: 'Has Blue', enabled: true },
            { productTag: 'Red', orderTag: 'Has Red', enabled: true }
        ]
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup default mocks
        (prisma.account.findUnique as any).mockResolvedValue(mockMappings);
    });

    it('demonstrates N+1 issue when calling extractTagsFromOrder in a loop', async () => {
        // Setup mock products
        // When called with specific IDs, return appropriate products
        (prisma.wooProduct.findMany as any).mockImplementation(({ where }: any) => {
           const ids = where.wooId.in;
           if (ids.includes(101) && ids.length === 1) return Promise.resolve([{ wooId: 101, rawData: { tags: [{ name: 'Blue' }] } }]);
           if (ids.includes(102) && ids.length === 1) return Promise.resolve([{ wooId: 102, rawData: { tags: [{ name: 'Red' }] } }]);
           if (ids.includes(101) && ids.includes(102)) return Promise.resolve([
               { wooId: 101, rawData: { tags: [{ name: 'Blue' }] } },
               { wooId: 102, rawData: { tags: [{ name: 'Red' }] } }
           ]);
           return Promise.resolve([]);
        });

        const orders = [
            { id: 1, line_items: [{ product_id: 101 }] },
            { id: 2, line_items: [{ product_id: 102 }] },
            { id: 3, line_items: [{ product_id: 101 }, { product_id: 102 }] }
        ];

        // Simulate loop in OrderSync
        for (const order of orders) {
            await OrderTaggingService.extractTagsFromOrder(accountId, order);
        }

        // Verify prisma.wooProduct.findMany called 3 times (once per order)
        // Also account.findUnique is called 3 times
        expect(prisma.wooProduct.findMany).toHaveBeenCalledTimes(3);
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(3);
    });

    it('optimized batch fetching fetches products in a single query', async () => {
        // Setup mock products
        // When called with specific IDs, return appropriate products
        (prisma.wooProduct.findMany as any).mockImplementation(({ where }: any) => {
            const ids = where.wooId.in;
            // The batch call asks for both IDs
            if (ids.includes(101) && ids.includes(102)) return Promise.resolve([
                { wooId: 101, rawData: { tags: [{ name: 'Blue' }] } },
                { wooId: 102, rawData: { tags: [{ name: 'Red' }] } }
            ]);
            return Promise.resolve([]);
        });

        const orders = [
            { id: 1, line_items: [{ product_id: 101 }] },
            { id: 2, line_items: [{ product_id: 102 }] },
            { id: 3, line_items: [{ product_id: 101 }, { product_id: 102 }] }
        ];

        // Call batch method
        const result = await OrderTaggingService.extractTagsForOrders(accountId, orders);

        // Verify prisma.wooProduct.findMany called ONLY ONCE
        expect(prisma.wooProduct.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(1);

        // Verify results
        expect(result.get(1)).toEqual(['Has Blue']);
        expect(result.get(2)).toEqual(['Has Red']);
        // Order 3 has both products, so both tags
        const tags3 = result.get(3);
        expect(tags3).toContain('Has Blue');
        expect(tags3).toContain('Has Red');
        expect(tags3?.length).toBe(2);
    });
});
