import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerSync } from '../CustomerSync';

const mockPrisma = vi.hoisted(() => ({
    wooCustomer: {
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
        findUnique: vi.fn()
    },
    $executeRawUnsafe: vi.fn()
}));

vi.mock('../../../utils/prisma', () => ({
    prisma: mockPrisma
}));

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

        mockPrisma.wooCustomer.count.mockResolvedValue(0);
        mockPrisma.conversation.findMany.mockResolvedValue([]);
        mockPrisma.conversation.updateMany.mockResolvedValue({ count: 0 });
        mockPrisma.wooCustomer.findMany.mockResolvedValue([]);
        mockPrisma.wooCustomer.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.syncState.findUnique.mockResolvedValue(null);
    });

    it('merges inbox placeholder customer when Woo customer upsert hits unique-email conflict', async () => {
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

        mockPrisma.wooCustomer.upsert.mockRejectedValue({ code: 'P2002', message: 'Unique constraint failed' });
        mockPrisma.wooCustomer.findFirst.mockResolvedValue({
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

        expect(mockPrisma.wooCustomer.findFirst).toHaveBeenCalledWith({
            where: {
                accountId,
                email: { equals: 'new.user@example.com', mode: 'insensitive' }
            }
        });

        expect(mockPrisma.wooCustomer.update).toHaveBeenCalledWith({
            where: { id: 'cust-placeholder-1' },
            data: expect.objectContaining({
                wooId: 456,
                email: 'new.user@example.com',
                firstName: 'New',
                lastName: 'User',
                ordersCount: 0
            })
        });
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
        mockPrisma.wooCustomer.upsert.mockRejectedValue(new Error('database unavailable'));

        await expect(
            (sync as any).sync(mockWoo, 'account-1', true)
        ).rejects.toThrow('checkpoint was not advanced');

        expect(mockPrisma.wooCustomer.deleteMany).not.toHaveBeenCalled();
    });
});
