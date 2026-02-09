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
        $queryRaw: vi.fn(),
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

    it('should update customer order counts via two-step approach', async () => {
        const accountId = 'acc_123';
        const syncId = 'sync_123';

        // 1. Mock WooService to return no orders, so we skip the sync loop
        (mockWooService.getOrders as any).mockResolvedValue({ data: [], totalPages: 0 });

        // Mock getLastSync -> returns null
        (prisma.syncState.findUnique as any).mockResolvedValue(null);

        // 2. Mock $queryRaw to return aggregated counts (step 1 of two-step approach)
        const customerCount = 50;
        const mockCounts = Array.from({ length: customerCount }, (_, i) => ({
            woo_id: i + 1,
            count: 2,
        }));

        (prisma.$queryRaw as any).mockResolvedValue(mockCounts);
        (prisma.wooCustomer.updateMany as any).mockResolvedValue({ count: 1 });

        // 3. Run sync (incremental=true to skip reconciliation)
        // @ts-ignore - sync is protected
        await orderSync.sync(mockWooService, accountId, true, undefined, syncId);

        // 4. Verify two-step approach: $queryRaw for counts, updateMany per customer batch
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

        // updateMany called once per customer (batched in groups of 50)
        expect(prisma.wooCustomer.updateMany).toHaveBeenCalledTimes(customerCount);

        console.log(`Executed two-step batch update for ${customerCount} customers.`);
    });
});
