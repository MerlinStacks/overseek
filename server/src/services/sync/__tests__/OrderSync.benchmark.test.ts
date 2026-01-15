import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OrderSync } from '../OrderSync';
import { prisma } from '../../../utils/prisma';
import { WooService } from '../../woo';
import { Logger } from '../../../utils/logger';

// Mock prisma
vi.mock('../../../utils/prisma', () => {
    const mockPrisma = {
        wooOrder: {
            findMany: vi.fn(),
            upsert: vi.fn(),
            delete: vi.fn(),
        },
        wooCustomer: {
            updateMany: vi.fn(),
        },
        syncState: {
            findUnique: vi.fn(),
        },
        $transaction: vi.fn(),
        $executeRaw: vi.fn(),
    };

    // Mock Prisma helpers
    const MockPrisma = {
        sql: (strings: any, ...values: any[]) => ({ strings, values }),
        join: (values: any[]) => values,
    };

    return { prisma: mockPrisma, Prisma: MockPrisma };
});

// Mock Logger
vi.mock('../../../utils/logger', () => {
    return {
        Logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }
    };
});

// Mock WooService
const mockWooService = {
    getOrders: vi.fn(),
} as unknown as WooService;

describe('OrderSync Benchmark', () => {
    let orderSync: OrderSync;

    beforeEach(() => {
        orderSync = new OrderSync();
        vi.clearAllMocks();
    });

    it('should update customer order counts (N+1 reproduction)', async () => {
        const accountId = 'acc_123';
        const syncId = 'sync_123';

        // 1. Mock WooService to return no orders, so we skip the sync loop
        (mockWooService.getOrders as any).mockResolvedValue({ data: [], totalPages: 0 });

        // Mock getLastSync -> returns null
        (prisma.syncState.findUnique as any).mockResolvedValue(null);

        // 2. Mock prisma.wooOrder.findMany to return orders with customer IDs for recalculation
        const customerCount = 50;
        const orders: any[] = [];
        // Create 2 orders for each customer
        for (let i = 1; i <= customerCount; i++) {
            orders.push({ rawData: { customer_id: i } });
            orders.push({ rawData: { customer_id: i } });
        }

        (prisma.wooOrder.findMany as any).mockResolvedValue(orders);
        (prisma.wooCustomer.updateMany as any).mockResolvedValue({ count: 1 });

        // 3. Run sync (incremental=true to skip reconciliation)
        // @ts-ignore - sync is protected
        await orderSync.sync(mockWooService, accountId, true, undefined, syncId);

        // 4. Verify optimization
        // We expect findMany to be called 0 times (optimized out by direct SQL update)
        expect(prisma.wooOrder.findMany).toHaveBeenCalledTimes(0);

        // We expect updateMany to be called 0 times (replaced by raw query)
        expect(prisma.wooCustomer.updateMany).toHaveBeenCalledTimes(0);

        // We expect executeRaw to be called once
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

        console.log(`Executed optimized batch update.`);
    });
});
