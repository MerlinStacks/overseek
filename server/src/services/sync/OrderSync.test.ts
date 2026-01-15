import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderSync } from './OrderSync';
import { prisma } from '../../utils/prisma';

// Mock dependencies
vi.mock('../../utils/prisma', () => ({
    prisma: {
        $executeRaw: vi.fn(),
        wooOrder: {
            findMany: vi.fn(),
            upsert: vi.fn(),
            delete: vi.fn()
        },
        $transaction: vi.fn(),
        syncState: {
            findUnique: vi.fn(),
            upsert: vi.fn()
        },
        syncLog: {
            create: vi.fn(),
            update: vi.fn()
        }
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
        extractTagsFromOrder: vi.fn()
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

    it('should use optimized SQL for recalculating customer counts', async () => {
        const accountId = 'test-account';
        await orderSync.testRecalculate(accountId);

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

        // Verify SQL structure
        // prisma.$executeRaw is called as a tagged template: fn(["SQL part 1", "SQL part 2", ...], param1, param2...)
        const call = (prisma.$executeRaw as any).mock.calls[0];
        const templateStrings = call[0]; // TemplateStringsArray

        // Join the strings to see the query structure (ignoring parameter placement for simple check)
        const fullQuery = templateStrings.join('?');

        expect(fullQuery).toContain('UPDATE "WooCustomer" wc');
        expect(fullQuery).toContain('SET "ordersCount" = c.count');
        expect(fullQuery).toContain('GROUP BY "rawData"->>\'customer_id\'');
        expect(fullQuery).toContain('WHERE "accountId" = ?');

        // Check params
        // We pass accountId 3 times in the query
        const params = call.slice(1);
        expect(params).toContain(accountId);
        expect(params.filter((p: any) => p === accountId).length).toBe(2);
    });
});
