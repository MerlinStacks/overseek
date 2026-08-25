import { beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock('../../utils/redis', () => ({ redisClient: redis }));

import { SyncCancellationService } from './SyncCancellationService';

describe('SyncCancellationService', () => {
    beforeEach(() => vi.clearAllMocks());

    it('marks active jobs for cooperative cancellation', async () => {
        await SyncCancellationService.request('sync-orders', 'job-1');
        expect(redis.set).toHaveBeenCalledWith('sync:cancel:sync-orders:job-1', '1', 'EX', 3600);
    });

    it('throws an unrecoverable error when cancellation was requested', async () => {
        redis.get.mockResolvedValue('1');
        await expect(SyncCancellationService.assertNotRequested({ queueName: 'sync-orders', id: 'job-1' }))
            .rejects.toThrow('Cancelled by user');
    });
});
