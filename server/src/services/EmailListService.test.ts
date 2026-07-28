import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
    account: { findUnique: vi.fn() },
    emailList: { findMany: vi.fn() },
    emailListMember: { createMany: vi.fn() },
    emailUnsubscribe: { upsert: vi.fn() }
}));

vi.mock('../utils/prisma', () => ({ prisma: prismaMock }));

import { EmailListService } from './EmailListService';

describe('EmailListService new customer defaults', () => {
    const service = new EmailListService();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('subscribes a new customer to every active default list', async () => {
        prismaMock.account.findUnique.mockResolvedValue({ subscribeNewCustomersByDefault: true });
        prismaMock.emailList.findMany.mockResolvedValue([{ id: 'list-1' }, { id: 'list-2' }]);
        prismaMock.emailListMember.createMany.mockResolvedValue({ count: 2 });

        await service.applyNewCustomerDefaults('account-1', ' Customer@Example.com ', 'customer-1');

        expect(prismaMock.emailListMember.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ listId: 'list-1', email: 'customer@example.com', wooCustomerId: 'customer-1', isSubscribed: true, source: 'DEFAULT' }),
                expect.objectContaining({ listId: 'list-2', email: 'customer@example.com', wooCustomerId: 'customer-1', isSubscribed: true, source: 'DEFAULT' })
            ],
            skipDuplicates: true
        });
        expect(prismaMock.emailUnsubscribe.upsert).not.toHaveBeenCalled();
    });

    it('suppresses marketing until the new customer explicitly subscribes when disabled', async () => {
        prismaMock.account.findUnique.mockResolvedValue({ subscribeNewCustomersByDefault: false });
        prismaMock.emailUnsubscribe.upsert.mockResolvedValue({ id: 'suppression-1' });

        await service.applyNewCustomerDefaults('account-1', 'customer@example.com', 'customer-1');

        expect(prismaMock.emailUnsubscribe.upsert).toHaveBeenCalledWith({
            where: { accountId_email: { accountId: 'account-1', email: 'customer@example.com' } },
            create: {
                accountId: 'account-1',
                email: 'customer@example.com',
                scope: 'MARKETING',
                reason: 'New customer default'
            },
            update: {}
        });
        expect(prismaMock.emailList.findMany).not.toHaveBeenCalled();
        expect(prismaMock.emailListMember.createMany).not.toHaveBeenCalled();
    });
});
