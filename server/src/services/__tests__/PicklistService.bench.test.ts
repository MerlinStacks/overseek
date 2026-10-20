
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PicklistService } from '../PicklistService';
import { prisma } from '../../utils/prisma';

// Mock the prisma client
vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooOrder: {
            findMany: vi.fn(),
        },
        wooProduct: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
        }
    }
}));

describe('PicklistService Benchmark', () => {
    let service: PicklistService;

    beforeEach(() => {
        service = new PicklistService();
        vi.clearAllMocks();
    });

    it('benchmarks generatePicklist performance', async () => {
        const ACCOUNT_ID = 'acc_123';
        const NUM_ORDERS = 50;
        const ITEMS_PER_ORDER = 3;

        // Mock Orders
        const orders = Array.from({ length: NUM_ORDERS }).map((_, i) => ({
            number: `ORD-${i}`,
            wooId: 1000 + i,
            accountId: ACCOUNT_ID,
            rawData: {
                line_items: Array.from({ length: ITEMS_PER_ORDER }).map((__, j) => ({
                    product_id: 2000 + (i * ITEMS_PER_ORDER) + j,
                    variation_id: 0,
                    quantity: i === 0 && j === 0 ? 2 : 1,
                    name: `Product ${2000 + (i * ITEMS_PER_ORDER) + j}`
                }))
            }
        }));

        (prisma.wooOrder.findMany as any).mockResolvedValue(orders);

        const getMockProduct = (wooId: number) => {
            let boms: any[] = [];
            // BOMs for 2000-2010
            if (wooId >= 2000 && wooId < 2010) {
                 boms = [{
                    variationId: 0,
                    items: [{
                        quantity: 3,
                        childProduct: {
                            wooId: wooId + 1000,
                            name: `Child of ${wooId}`,
                            sku: `CHILD-${wooId}`
                        }
                    }]
                 }];
            }

            return {
                id: `prod_${wooId}`,
                wooId: wooId,
                name: `Product ${wooId}`,
                sku: `SKU-${wooId}`,
                boms: boms,
                variations: [],
                rawData: { manage_stock: true },
                stockStatus: 'instock',
                binLocation: 'A-01',
                images: []
            };
        };

        // A fallback lookup must not be needed for this fully-prefetched fixture.
        (prisma.wooProduct.findFirst as any).mockImplementation(async ({ where }) => {
            return getMockProduct(where.wooId);
        });

        // Mock findMany for the future optimized version
        (prisma.wooProduct.findMany as any).mockImplementation(async (args: any) => {
             // Handle 'in' clause
             const ids = args?.where?.wooId?.in;
             if (Array.isArray(ids)) {
                 return ids.map((id: number) => getMockProduct(id));
             }
             // Handle single lookup if implementation changes to use findMany for single items too
             if (args?.where?.wooId) {
                 return [getMockProduct(args.where.wooId)];
             }
             return [];
        });

        const result = await service.generatePicklist(ACCOUNT_ID, { limit: 100 });

        const findFirstCalls = (prisma.wooProduct.findFirst as any).mock.calls.length;
        const findManyCalls = (prisma.wooProduct.findMany as any).mock.calls.length;

        expect(findFirstCalls).toBe(0);
        expect(findManyCalls).toBe(2); // One order-product batch, one BOM-component batch.
        for (const [query] of vi.mocked(prisma.wooProduct.findMany).mock.calls) {
            expect(query.where.accountId).toBe(ACCOUNT_ID);
        }
        expect(prisma.wooOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId: ACCOUNT_ID, status: 'processing' }, take: 100,
        }));
        expect(result).toHaveLength(150);
        expect(result.reduce((sum, item) => sum + item.totalQuantity, 0)).toBe(173);
        expect(result.some(item => item.productId === '2000')).toBe(false);
        expect(result.find(item => item.productId === '3000')).toEqual(expect.objectContaining({
            totalQuantity: 6,
            quantityUpdates: [{ orderNumber: 'ORD-0', quantity: 6, wooOrderId: 1000 }],
        }));
        expect(result.find(item => item.productId === '2010')?.totalQuantity).toBe(1);
    });
});
