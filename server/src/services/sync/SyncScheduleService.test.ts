import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    upsert: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
}));

vi.mock('../../utils/prisma', () => ({ prisma: { syncSchedule: mocks } }));

import { SyncScheduleService } from './SyncScheduleService';

describe('SyncScheduleService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.upsert.mockResolvedValue({});
        mocks.findMany.mockResolvedValue([]);
        mocks.update.mockResolvedValue({});
        mocks.updateMany.mockResolvedValue({ count: 7 });
    });

    it('creates defaults for every supported entity', async () => {
        await SyncScheduleService.ensureAccountSchedules('account-1');
        expect(mocks.upsert).toHaveBeenCalledTimes(7);
        expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ accountId: 'account-1', entityType: 'orders', intervalMinutes: 1 })
        }));
    });

    it('rejects unsafe intervals', async () => {
        await expect(SyncScheduleService.update('account-1', 'orders', { intervalMinutes: 0 }))
            .rejects.toThrow('between 1 and 1440');
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('reschedules from now when the interval changes', async () => {
        await SyncScheduleService.update('account-1', 'orders', { intervalMinutes: 15 });
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ intervalMinutes: 15, nextRunAt: expect.any(Date) })
        }));
    });
});
