import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderSync } from './OrderSync';
import { prisma } from '../../utils/prisma';

// Mock dependencies
vi.mock('../../utils/prisma', () => ({
    prisma: {
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
        wooOrder: {
            findMany: vi.fn(),
            upsert: vi.fn(),
            delete: vi.fn()
        },
        wooCustomer: {
            updateMany: vi.fn()
        },
        syncState: {
            findUnique: vi.fn(),
            upsert: vi.fn()
        },
        syncLog: {
            create: vi.fn(),
            update: vi.fn()
        }
    },
    Prisma: {
        sql: vi.fn(),
        join: vi.fn()
    }
}));

// Mock Logger
vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock other dependencies that OrderSync imports
vi.mock('../woo', () => ({
    WooService: {
        forAccount: vi.fn()
    }
}));

vi.mock('../search/IndexingService', () => ({
    IndexingService: {
        indexOrder: vi.fn(),
        deleteOrder: vi.fn()
    }
}));

vi.mock('../OrderTaggingService', () => ({
    OrderTaggingService: {
        extractTagsFromOrder: vi.fn(),
        getTagMappings: vi.fn()
    }
}));

vi.mock('../events', () => ({
    EventBus: {
        emit: vi.fn()
    },
    EVENTS: {
        ORDER: {
            CREATED: 'order.created',
            SYNCED: 'order.synced'
        }
    }
}));

// Create a subclass to access protected method
class TestOrderSync extends OrderSync {
    public async testRecalculate(accountId: string) {
        return this.recalculateCustomerCounts(accountId);
    }
}

describe('OrderSync Optimization', () => {
    let orderSync: TestOrderSync;

    beforeEach(() => {
        vi.clearAllMocks();
        orderSync = new TestOrderSync();
    });

    it('should use two-step approach for recalculating customer counts', async () => {
        const accountId = 'test-account';

        // Step 1: $queryRaw returns aggregated counts
        const mockCounts = [
            { woo_id: 101, count: 3 },
            { woo_id: 202, count: 5 },
        ];
        (prisma.$queryRaw as any).mockResolvedValue(mockCounts);

        // Step 2: $transaction batches the updateMany calls
        (prisma.$transaction as any).mockResolvedValue([]);
        (prisma.wooCustomer.updateMany as any).mockResolvedValue({ count: 1 });

        await orderSync.testRecalculate(accountId);

        // Verify Step 1: Read counts via $queryRaw (no locks held)
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

        // Verify Step 2: Batched updates via $transaction
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);

        // Each customer gets an updateMany call inside the transaction
        expect(prisma.wooCustomer.updateMany).toHaveBeenCalledTimes(2);
        expect(prisma.wooCustomer.updateMany).toHaveBeenCalledWith({
            where: { accountId, wooId: 101 },
            data: { ordersCount: 3 }
        });
        expect(prisma.wooCustomer.updateMany).toHaveBeenCalledWith({
            where: { accountId, wooId: 202 },
            data: { ordersCount: 5 }
        });
    });

    it('should skip update when no customer orders exist', async () => {
        const accountId = 'test-account';
        (prisma.$queryRaw as any).mockResolvedValue([]);

        await orderSync.testRecalculate(accountId);

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should not break sync if recalculation fails', async () => {
        const accountId = 'test-account';
        (prisma.$queryRaw as any).mockRejectedValue(new Error('DB connection lost'));

        // Should not throw
        await expect(orderSync.testRecalculate(accountId)).resolves.not.toThrow();
    });
});
