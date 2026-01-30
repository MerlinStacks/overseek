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
        },
        $transaction: vi.fn((ops) => Promise.all(ops)),
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
        (prisma.account.findUnique as any).mockResolvedValue(mockMappings);
    });

    it('demonstrates N+1 issue when calling extractTagsFromOrder in a loop', async () => {
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

        for (const order of orders) {
            await OrderTaggingService.extractTagsFromOrder(accountId, order);
        }

        expect(prisma.wooProduct.findMany).toHaveBeenCalledTimes(3);
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(3);
    });

    it('optimized: extractTagsFromOrder with knownMappings avoids redundant lookups', async () => {
        const mockAccount = {
            orderTagMappings: [
                { productTag: 'pt1', orderTag: 'ot1', enabled: true }
            ]
        };
        (prisma.account.findUnique as any).mockResolvedValue(mockAccount);
        (prisma.wooProduct.findMany as any).mockResolvedValue([
            { rawData: { tags: [{ name: 'pt1' }] } }
        ]);

        const orders = Array.from({ length: 25 }, (_, i) => ({
            id: i,
            line_items: [{ product_id: 100 + i }]
        }));

        // Optimization: fetch mappings once
        const mappings = await OrderTaggingService.getTagMappings(accountId);
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        (prisma.account.findUnique as any).mockResolvedValue(mockAccount);
        (prisma.wooProduct.findMany as any).mockResolvedValue([
            { rawData: { tags: [{ name: 'pt1' }] } }
        ]);

        for (const order of orders) {
            await OrderTaggingService.extractTagsFromOrder(accountId, order, mappings);
        }

        // Assert that findUnique was NOT called (0 times) - mappings passed in
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(0);
    });

    it('optimized batch fetching fetches products in a single query', async () => {
        (prisma.wooProduct.findMany as any).mockImplementation(({ where }: any) => {
            const ids = where.wooId.in;
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

        const result = await OrderTaggingService.extractTagsForOrders(accountId, orders);

        expect(prisma.wooProduct.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(1);

        expect(result.get(1)).toEqual(['Has Blue']);
        expect(result.get(2)).toEqual(['Has Red']);
        const tags3 = result.get(3);
        expect(tags3).toContain('Has Blue');
        expect(tags3).toContain('Has Red');
        expect(tags3?.length).toBe(2);
    });
});
