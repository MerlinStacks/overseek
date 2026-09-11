import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OrderSync } from '../OrderSync';
import { prisma } from '../../../utils/prisma';
import { WooService } from '../../woo';

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
            findMany: vi.fn().mockResolvedValue([]),
        },
        syncState: {
            findUnique: vi.fn(),
        },
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
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
        (prisma.$transaction as any).mockImplementation(async (work: any) => work(prisma));
    });

    it('does not rebuild customer totals during an empty incremental sync', async () => {
        const accountId = 'acc_123';
        const syncId = 'sync_123';

        // Empty incremental polls must not perform an account-wide aggregate rebuild.
        (mockWooService.getOrders as any).mockResolvedValue({ data: [], totalPages: 0 });

        (prisma.syncState.findUnique as any).mockResolvedValue({ lastSyncedAt: new Date() });
        // @ts-ignore - sync is protected
        await orderSync.sync(mockWooService, accountId, true, undefined, syncId);

        // Empty changed-customer and reindex pages acquire locks, but do not aggregate.
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        expect(prisma.wooCustomer.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId, updatedAt: { gte: expect.any(Date) } }, take: 500
        }));

        expect(prisma.wooCustomer.updateMany).not.toHaveBeenCalled();

    });
});
