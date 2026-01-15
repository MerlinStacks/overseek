import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderTaggingService } from '../OrderTaggingService';
import { prisma } from '../../utils/prisma';

// Mock prisma
vi.mock('../../utils/prisma', () => ({
    prisma: {
        account: {
            findUnique: vi.fn(),
        },
        wooProduct: {
            findMany: vi.fn(),
        },
        $transaction: vi.fn((ops) => Promise.all(ops)),
    }
}));

describe('OrderTaggingService Benchmark', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('baseline: extractTagsFromOrder calls getTagMappings every time', async () => {
        const accountId = 'acc_123';
        const orders = Array.from({ length: 25 }, (_, i) => ({
            id: i,
            line_items: [{ product_id: 100 + i }]
        }));

        // Mock getTagMappings response (via prisma)
        const mockAccount = {
            orderTagMappings: [
                { productTag: 'pt1', orderTag: 'ot1', enabled: true }
            ]
        };
        (prisma.account.findUnique as any).mockResolvedValue(mockAccount);

        // Mock wooProduct.findMany
        (prisma.wooProduct.findMany as any).mockResolvedValue([
            { rawData: { tags: [{ name: 'pt1' }] } }
        ]);

        for (const order of orders) {
            await OrderTaggingService.extractTagsFromOrder(accountId, order);
        }

        // Assert that findUnique was called for each order
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(25);
    });

    it('optimized: extractTagsFromOrder with knownMappings calls getTagMappings 0 times inside loop', async () => {
        const accountId = 'acc_123';
        const orders = Array.from({ length: 25 }, (_, i) => ({
            id: i,
            line_items: [{ product_id: 100 + i }]
        }));

        // Mock getTagMappings response (via prisma)
        const mockAccount = {
            orderTagMappings: [
                { productTag: 'pt1', orderTag: 'ot1', enabled: true }
            ]
        };
        (prisma.account.findUnique as any).mockResolvedValue(mockAccount);

        // Mock wooProduct.findMany
        (prisma.wooProduct.findMany as any).mockResolvedValue([
            { rawData: { tags: [{ name: 'pt1' }] } }
        ]);

        // Optimization: fetch mappings once
        const mappings = await OrderTaggingService.getTagMappings(accountId);
        // Note: In real OrderSync, this call happens.
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(1);

        // Reset mock to verify calls inside loop
        vi.clearAllMocks();
        // Re-apply mocks after clear
        (prisma.account.findUnique as any).mockResolvedValue(mockAccount);
        (prisma.wooProduct.findMany as any).mockResolvedValue([
            { rawData: { tags: [{ name: 'pt1' }] } }
        ]);


        for (const order of orders) {
            await OrderTaggingService.extractTagsFromOrder(accountId, order, mappings);
        }

        // Assert that findUnique was NOT called (0 times)
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(0);
    });
});
