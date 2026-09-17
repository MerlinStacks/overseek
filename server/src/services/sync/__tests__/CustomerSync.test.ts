import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerSync } from '../CustomerSync';
import { IndexingService } from '../../search/IndexingService';
import { esClient } from '../../../utils/elastic';

const mockPrisma = vi.hoisted(() => ({
    wooCustomer: {
        findUnique: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
        deleteMany: vi.fn()
    },
    conversation: {
        findMany: vi.fn(),
        updateMany: vi.fn()
    },
    syncState: {
        upsert: vi.fn(),
        findUnique: vi.fn()
    },
    $executeRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn()
}));

vi.mock('../../../utils/prisma', () => ({
    prisma: mockPrisma
}));
vi.mock('../../../utils/elastic', () => ({ esClient: { bulk: vi.fn().mockResolvedValue({ errors: false }), delete: vi.fn() } }));

vi.mock('../../search/IndexingService', () => ({
    IndexingService: {
        bulkIndexCustomers: vi.fn().mockResolvedValue(undefined),
        deleteCustomer: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('../../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn()
    }
}));

describe('CustomerSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma.$transaction.mockImplementation(async work => work(mockPrisma));
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrisma.wooCustomer.findUnique.mockResolvedValue(null);
        mockPrisma.wooCustomer.findFirst.mockResolvedValue(null);
        mockPrisma.wooCustomer.create.mockResolvedValue({ id: 'current', wooId: 456 });

        mockPrisma.wooCustomer.count.mockResolvedValue(0);
        mockPrisma.conversation.findMany.mockResolvedValue([]);
        mockPrisma.conversation.updateMany.mockResolvedValue({ count: 0 });
        mockPrisma.wooCustomer.findMany.mockResolvedValue([]);
        mockPrisma.wooCustomer.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.syncState.findUnique.mockResolvedValue(null);
    });

    it('promotes inbox placeholder before creating a Woo customer even though email is not unique', async () => {
        const accountId = 'account-1';
        const sync = new CustomerSync();

        const wooCustomer = {
            id: 456,
            email: 'new.user@example.com',
            first_name: 'New',
            last_name: 'User',
            total_spent: '0',
            orders_count: 0
        };

        const mockWoo = {
            getCustomers: vi.fn().mockResolvedValue({
                data: [wooCustomer],
                totalPages: 1
            })
        };

        mockPrisma.wooCustomer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
            id: 'cust-placeholder-1',
            accountId,
            email: 'new.user@example.com',
            wooId: -3
        });
        mockPrisma.wooCustomer.update.mockResolvedValue({
            id: 'cust-placeholder-1',
            accountId,
            email: 'new.user@example.com',
            wooId: 456
        });

        const result = await (sync as any).sync(mockWoo, accountId, false);

        expect(result).toEqual({ itemsProcessed: 1, itemsDeleted: 0 });

        expect(mockPrisma.wooCustomer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                accountId,
                email: { equals: 'new.user@example.com', mode: 'insensitive' },
                wooId: { lt: 0 }
            }
        }));

        expect(mockPrisma.wooCustomer.update).toHaveBeenCalledWith({
            where: { id: 'cust-placeholder-1', accountId },
            data: expect.objectContaining({
                wooId: 456,
                email: 'new.user@example.com',
                firstName: 'New',
                lastName: 'User'
            })
        });
    });

    it('restricts full-sync reconciliation and its safety cap to remote customers', async () => {
        mockPrisma.wooCustomer.upsert.mockResolvedValue({ id: 'current', wooId: 456 });
        mockPrisma.wooCustomer.count.mockResolvedValueOnce(1).mockResolvedValueOnce(20);
        mockPrisma.wooCustomer.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'stale', wooId: 123 }]);
        mockPrisma.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) =>
            sql.join('').includes('SELECT c.') ? [{ id: 'stale', wooId: 123 }] : []);
        mockPrisma.wooCustomer.deleteMany.mockResolvedValue({ count: 1 });
        const woo = { getCustomers: vi.fn().mockResolvedValue({
            data: [{ id: 456, email: 'current@example.com', first_name: 'Current', last_name: 'Customer' }],
            totalPages: 1
        }) };

        const result = await (new CustomerSync() as any).sync(woo, 'account-1', false);
        const staleWhere = { accountId: 'account-1', wooId: { gt: 0 }, updatedAt: { lt: expect.any(Date) } };
        expect(mockPrisma.wooCustomer.count).toHaveBeenNthCalledWith(1, { where: staleWhere });
        expect(mockPrisma.wooCustomer.count).toHaveBeenNthCalledWith(2, {
            where: { accountId: 'account-1', wooId: { gt: 0 } }
        });
        expect(mockPrisma.wooCustomer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: staleWhere }));
        expect(mockPrisma.wooCustomer.deleteMany).toHaveBeenCalledWith({ where: { accountId: 'account-1', id: { in: ['stale'] } } });
        const reconciliationSql = mockPrisma.$queryRaw.mock.calls.map(([sql]) => sql.join('')).find(sql => sql.includes('SELECT c.'));
        expect(reconciliationSql).toContain('"AutomationEnrollment"');
        expect(reconciliationSql).toContain('"WooOrder"');
        expect(esClient.delete).not.toHaveBeenCalled();
        expect(mockPrisma.syncState.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ accountId: 'account-1', entityType: 'contact-projection:123' })
        }));
        expect(result.itemsDeleted).toBe(1);
    });

    it('fails without advancing past a durable write failure', async () => {
        const sync = new CustomerSync();
        const mockWoo = {
            getCustomers: vi.fn().mockResolvedValue({
                data: [{
                    id: 789,
                    email: 'customer@example.com',
                    first_name: 'Test',
                    last_name: 'Customer',
                    total_spent: '10.00',
                    orders_count: 1
                }],
                totalPages: 1
            })
        };
        mockPrisma.wooCustomer.create.mockRejectedValue(new Error('database unavailable'));

        await expect(
            (sync as any).sync(mockWoo, 'account-1', true)
        ).rejects.toThrow('checkpoint was not advanced');

        expect(mockPrisma.wooCustomer.deleteMany).not.toHaveBeenCalled();
    });
});
