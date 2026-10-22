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
        vi.resetAllMocks();
        (prisma.account.findUnique as any).mockResolvedValue(mockMappings);
    });

    it('returns the right mapped tags for individually processed orders', async () => {
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

        const results = [];
        for (const order of orders) results.push(await OrderTaggingService.extractTagsFromOrder(accountId, order));
        expect(results).toEqual([['Has Blue'], ['Has Red'], ['Has Blue', 'Has Red']]);
        expect(vi.mocked(prisma.wooProduct.findMany).mock.calls.length).toBeLessThanOrEqual(orders.length);
        for (const [query] of vi.mocked(prisma.wooProduct.findMany).mock.calls) expect(query.where.accountId).toBe(accountId);
    });

    it('optimized: extractTagsFromOrder with knownMappings avoids redundant lookups', async () => {
        const mockAccount = {
            orderTagMappings: [
                { productTag: 'pt1', orderTag: 'ot1', enabled: true }
            ]
        };
        (prisma.account.findUnique as any).mockResolvedValue(mockAccount);
        (prisma.wooProduct.findMany as any).mockImplementation(async ({ where }: any) => where.wooId.in.map((wooId: number) => ({ wooId, rawData: { tags: [{ name: 'pt1' }] } })));

        const orders = Array.from({ length: 25 }, (_, i) => ({
            id: i + 1,
            line_items: [{ product_id: 100 + i }]
        }));

        // Optimization: fetch mappings once
        const mappings = await OrderTaggingService.getTagMappings(accountId);
        expect(prisma.account.findUnique).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        (prisma.account.findUnique as any).mockResolvedValue(mockAccount);
        (prisma.wooProduct.findMany as any).mockImplementation(async ({ where }: any) => where.wooId.in.map((wooId: number) => ({ wooId, rawData: { tags: [{ name: 'pt1' }] } })));

        for (const order of orders) {
            expect(await OrderTaggingService.extractTagsFromOrder(accountId, order, mappings)).toEqual(['ot1']);
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

    it('deduplicates products and tags, matches case-insensitively, and ignores disabled mappings', async () => {
        vi.mocked(prisma.account.findUnique).mockResolvedValue({ orderTagMappings: [
            { productTags: ['Blue', 'Red'], orderTag: 'Colour', enabled: true },
            { productTag: 'Blue', orderTag: 'Disabled', enabled: false },
        ] } as any);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([
            { wooId: 101, rawData: { tags: [{ name: 'BLUE' }, { name: 'red' }] } },
            { wooId: 999, rawData: { tags: [] } },
        ] as any);
        const result = await OrderTaggingService.extractTagsForOrders(accountId, [
            { id: 1, line_items: [{ product_id: 101 }, { product_id: 101 }] },
            { id: 2, line_items: [{ product_id: 999 }] },
            { id: 3, line_items: [] },
        ]);
        expect([...result]).toEqual([[1, ['Colour']], [2, []], [3, []]]);
        expect(prisma.wooProduct.findMany).toHaveBeenCalledWith({
            where: { accountId, wooId: { in: [101, 999] } }, select: { wooId: true, rawData: true }, orderBy: { wooId: 'asc' }, take: 2001,
        });
    });

    it('does not fetch anything for an empty batch', async () => {
        expect(await OrderTaggingService.extractTagsForOrders(accountId, [])).toEqual(new Map());
        expect(prisma.account.findUnique).not.toHaveBeenCalled();
        expect(prisma.wooProduct.findMany).not.toHaveBeenCalled();
    });

    it('does not query products when mappings are disabled', async () => {
        vi.mocked(prisma.account.findUnique).mockResolvedValue({ orderTagMappings: [
            { productTag: 'Blue', orderTag: 'Disabled', enabled: false },
        ] } as any);
        expect(await OrderTaggingService.extractTagsForOrders(accountId, [{ id: 1, line_items: [{ product_id: 101 }] }]))
            .toEqual(new Map([[1, []]]));
        expect(prisma.wooProduct.findMany).not.toHaveBeenCalled();
    });

    it('propagates database failures instead of silently returning incorrect tags', async () => {
        vi.mocked(prisma.wooProduct.findMany).mockRejectedValue(new Error('Database unavailable'));
        await expect(OrderTaggingService.extractTagsForOrders(accountId, [{ id: 1, line_items: [{ product_id: 101 }] }]))
            .rejects.toThrow('Database unavailable');
    });
});
