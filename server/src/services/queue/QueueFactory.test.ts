import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    queue: {
        getJobCounts: vi.fn(),
        getJobs: vi.fn(),
        close: vi.fn()
    }
}));

vi.mock('bullmq', () => ({
    Queue: vi.fn(function MockQueue() {
        return mocks.queue;
    }),
    Worker: class {}
}));
vi.mock('../../utils/redis', () => ({
    redisClient: {},
    createWorkerConnection: vi.fn(() => ({}))
}));
vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));
vi.mock('@bull-board/api', () => ({ createBullBoard: vi.fn() }));
vi.mock('@bull-board/api/bullMQAdapter', () => ({ BullMQAdapter: class {} }));
vi.mock('@bull-board/fastify', () => ({
    FastifyAdapter: class {
        setBasePath() {}
    }
}));

import { QueueFactory } from './QueueFactory';

describe('QueueFactory queue depth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('counts and trims prioritized jobs', async () => {
        const jobs = [
            { timestamp: 1, remove: vi.fn().mockResolvedValue(undefined) },
            { timestamp: 2, remove: vi.fn().mockResolvedValue(undefined) }
        ];
        mocks.queue.getJobCounts.mockResolvedValue({ waiting: 0, prioritized: 502 });
        mocks.queue.getJobs.mockImplementation(async (states: string[]) =>
            states.includes('prioritized') ? jobs : []
        );

        const removed = await QueueFactory.enforceMaxQueueDepth('test-priority-depth');

        expect(removed).toBe(2);
        expect(mocks.queue.getJobs).toHaveBeenCalledWith(['prioritized'], 0, 1, true);
        expect(jobs[0].remove).toHaveBeenCalledOnce();
        expect(jobs[1].remove).toHaveBeenCalledOnce();
    });
});
