import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wholesaleCatalogShare: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } } }));
vi.mock('../../utils/getDefaultEmailAccount', () => ({ getDefaultEmailAccount: vi.fn() }));
vi.mock('../EmailService', () => ({ EmailService: class {} }));
vi.mock('../AuditService', () => ({ AuditActions: {}, AuditService: { log: vi.fn() } }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: {}, QUEUES: {} }));

import { WholesaleShareService } from './shares';

describe('wholesale share notification preferences', () => {
    beforeEach(() => vi.clearAllMocks());

    it('preserves snapshot data and updates only the account-owned share', async () => {
        mocks.findFirst.mockResolvedValue({ id: 'share-1', accountId: 'account-1', customerSnapshot: { company: 'Buyer Co', pageCount: 7 } });
        mocks.updateMany.mockResolvedValue({ count: 1 });

        const share = await WholesaleShareService.setNotificationsMuted('account-1', 'share-1', true);

        expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'share-1', accountId: 'account-1' } });
        expect(mocks.updateMany).toHaveBeenCalledWith({
            where: { id: 'share-1', accountId: 'account-1' },
            data: { customerSnapshot: { company: 'Buyer Co', pageCount: 7, notificationsMuted: true } },
        });
        expect(share.customerSnapshot.notificationsMuted).toBe(true);
    });
});
