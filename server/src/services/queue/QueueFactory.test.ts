import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    handlers: new Map<string, (...args: any[]) => void>(),
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
    Worker: vi.fn(function MockWorker() {
        return { on: (event: string, handler: (...args: any[]) => void) => mocks.handlers.set(event, handler), close: vi.fn().mockResolvedValue(undefined) };
    })
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

import { QueueFactory, queueWorkPolicy, QUEUES } from './QueueFactory';
import { Logger } from '../../utils/logger';

describe('QueueFactory queue depth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('backpressures prioritized backlog without deleting admitted work', async () => {
        const jobs = [
            { timestamp: 1, remove: vi.fn().mockResolvedValue(undefined) },
            { timestamp: 2, remove: vi.fn().mockResolvedValue(undefined) }
        ];
        mocks.queue.getJobCounts.mockResolvedValue({ waiting: 0, prioritized: 502 });
        mocks.queue.getJobs.mockImplementation(async (states: string[]) =>
            states.includes('prioritized') ? jobs : []
        );

        await expect(QueueFactory.enforceMaxQueueDepth('test-priority-depth')).rejects.toThrow('backlog');
        expect(mocks.queue.getJobs).not.toHaveBeenCalled();
        expect(jobs[0].remove).not.toHaveBeenCalled();
        expect(jobs[1].remove).not.toHaveBeenCalled();
    });
    it('retains failures and restricts automatic retries to named sync work', () => {
        expect(queueWorkPolicy(QUEUES.ORDERS)).toMatchObject({ attempts: 2, removeOnFail: false });
        for (const name of [QUEUES.CAMPAIGNS, QUEUES.AUTOMATIONS, QUEUES.BOM_SYNC, 'unknown']) expect(queueWorkPolicy(name)).toMatchObject({ attempts: 1, removeOnComplete: false, removeOnFail: false });
    });
    it('makes lost BOM locks actionable without automatically replaying stock writes', async () => {
        QueueFactory.createWorker(QUEUES.BOM_SYNC, async () => {});
        mocks.handlers.get('failed')!({ id: 'sync_bom_a', data: { accountId: 'a' }, progress: { current: 2, total: 10 } }, new Error('job stalled more than allowable limit'));
        expect(Logger.error).toHaveBeenCalledWith('Job sync_bom_a Failed', expect.objectContaining({ accountId: 'a', queueName: QUEUES.BOM_SYNC, code: 'BOM_SYNC_RECONCILIATION_REQUIRED', progress: { current: 2, total: 10 } }));
        await QueueFactory.closeWorkers();
    });
});
