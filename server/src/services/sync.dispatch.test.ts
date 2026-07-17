import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const queue = {
        getJob: vi.fn(),
        add: vi.fn()
    };
    return {
        queue,
        enforceMaxQueueDepth: vi.fn(),
        createQueue: vi.fn(() => queue)
    };
});

vi.mock('./queue/QueueFactory', () => ({
    QUEUES: {
        ORDERS: 'sync-orders',
        PRODUCTS: 'sync-products',
        CUSTOMERS: 'sync-customers',
        REVIEWS: 'sync-reviews',
        PAGES: 'sync-pages',
        BLOG_POSTS: 'sync-blog-posts',
        BOM_SYNC: 'bom-inventory-sync'
    },
    QueueFactory: {
        enforceMaxQueueDepth: mocks.enforceMaxQueueDepth,
        createQueue: mocks.createQueue
    }
}));

vi.mock('../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

import { SyncService } from './sync';

describe('SyncService dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.enforceMaxQueueDepth.mockResolvedValue(0);
        mocks.queue.add.mockResolvedValue({});
    });

    it('preserves an existing prioritized job', async () => {
        const existingJob = {
            id: 'sync_orders_account-1',
            getState: vi.fn().mockResolvedValue('prioritized'),
            remove: vi.fn()
        };
        mocks.queue.getJob.mockResolvedValue(existingJob);

        await new SyncService().runSync('account-1', { types: ['orders'] });

        expect(existingJob.remove).not.toHaveBeenCalled();
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });

    it('gives manual jobs higher priority than scheduled jobs', async () => {
        mocks.queue.getJob.mockResolvedValue(null);
        const service = new SyncService();

        await service.runSync('account-1', {
            types: ['orders'],
            triggerSource: 'MANUAL'
        });
        expect(mocks.queue.add.mock.calls[0][2].priority).toBe(1);

        mocks.queue.add.mockClear();
        await service.runSync('account-2', {
            types: ['orders'],
            triggerSource: 'SYSTEM'
        });
        expect(mocks.queue.add.mock.calls[0][2].priority).toBe(10);
    });
});
