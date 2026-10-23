import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    handlers: new Map<string, (...args: any[]) => void>(),
    processors: new Map<string, (job: any) => Promise<void>>(),
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
    Worker: vi.fn(function MockWorker(name: string, processor: (job: any) => Promise<void>) {
        mocks.processors.set(name, processor);
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
        mocks.handlers.clear(); mocks.processors.clear();
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
        mocks.handlers.get('failed')!({ id: 'sync_bom_a', processedOn: Date.now() - 600000, data: { accountId: 'a' }, progress: { current: 2, total: 10 } }, new Error('job stalled more than allowable limit'));
        expect(Logger.error).toHaveBeenCalledWith('Job sync_bom_a Failed', expect.objectContaining({ accountId: 'a', queueName: QUEUES.BOM_SYNC, code: 'BOM_SYNC_RECONCILIATION_REQUIRED', progress: { current: 2, total: 10 }, executionOrigin: 'pre-existing-or-other-worker', lockRenewalFailures: null }));
        await QueueFactory.closeWorkers();
    });
    it('records actual current-worker lock failures and successful renewals without logging tokens or payloads', async () => {
        let finish!: () => void;
        QueueFactory.createWorker(QUEUES.BOM_SYNC, () => new Promise<void>(resolve => { finish = resolve; }));
        const job = { id: 'bom', processedOn: Date.now(), data: { accountId: 'a', private: 'never-log-this' }, token: 'secret-token', progress: { current: 367, total: 1908, skipped: 367 } };
        const pending = mocks.processors.get(QUEUES.BOM_SYNC)!(job);
        mocks.handlers.get('locksRenewed')!({ count: 1, jobIds: ['bom'] });
        mocks.handlers.get('lockRenewalFailed')!(['bom']);
        mocks.handlers.get('failed')!(job, new Error('job stalled more than allowable limit'));
        expect(Logger.error).toHaveBeenCalledWith('Job bom Failed', expect.objectContaining({ executionOrigin: 'this-worker', processorStartedAt: expect.any(Number), lastLockRenewedAt: expect.any(Number), lockRenewalFailures: 1 }));
        expect(JSON.stringify(vi.mocked(Logger.error).mock.calls)).not.toMatch(/secret-token|never-log-this/);
        finish(); await pending; await QueueFactory.closeWorkers();
    });
});
