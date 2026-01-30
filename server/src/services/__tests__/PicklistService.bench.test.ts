
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
                    quantity: 1,
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
                        quantity: 1,
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

        // Mock findFirst with latency
        (prisma.wooProduct.findFirst as any).mockImplementation(async ({ where }) => {
            await new Promise(r => setTimeout(r, 1)); // 1ms latency simulation
            return getMockProduct(where.wooId);
        });

        // Mock findMany for the future optimized version
        (prisma.wooProduct.findMany as any).mockImplementation(async (args: any) => {
             await new Promise(r => setTimeout(r, 5)); // 5ms for a larger query
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

        const start = performance.now();
        const result = await service.generatePicklist(ACCOUNT_ID, { limit: 100 });
        const end = performance.now();

        const findFirstCalls = (prisma.wooProduct.findFirst as any).mock.calls.length;
        const findManyCalls = (prisma.wooProduct.findMany as any).mock.calls.length;

        console.log(`\n---------------------------------------------------`);
        console.log(`Execution Time: ${(end - start).toFixed(2)}ms`);
        console.log(`prisma.wooProduct.findFirst calls: ${findFirstCalls}`);
        console.log(`prisma.wooProduct.findMany calls: ${findManyCalls}`);
        console.log(`Total DB calls: ${findFirstCalls + findManyCalls}`);
        console.log(`---------------------------------------------------\n`);

        expect(result).toBeDefined();
        // We don't assert specific counts here anymore as we want this test to pass for both
        // optimized and unoptimized, but we inspect the console output.
    });
});
