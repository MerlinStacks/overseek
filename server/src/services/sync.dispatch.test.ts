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
import { bomExecutionFingerprint } from './bom/BOMReconciliationEvidence';

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
    it('retains failed/stalled BOM jobs rather than automatically replaying stock writes', async () => {
        const job = { id: 'sync_bom_account-1', data: { accountId: 'account-1' }, getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn() };
        mocks.queue.getJob.mockResolvedValue(job);
        await expect(new SyncService().runSync('account-1', { types: ['bom'] })).rejects.toMatchObject({ code: 'BOM_SYNC_RECONCILIATION_REQUIRED', statusCode: 409 });
        expect(job.remove).not.toHaveBeenCalled(); expect(mocks.queue.add).not.toHaveBeenCalled();
    });
    it('does not schedule over a completed legacy job that reported failed products', async () => {
        const job = { id: 'sync_bom_account-1', data: { accountId: 'account-1' }, progress: { failed: 1 }, getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn() };
        mocks.queue.getJob.mockImplementation(async id => id === job.id ? job : null);
        await expect(new SyncService().runSync('account-1', { types: ['bom'] })).rejects.toMatchObject({ code: 'BOM_SYNC_RECONCILIATION_REQUIRED' });
        expect(job.remove).not.toHaveBeenCalled(); expect(mocks.queue.add).not.toHaveBeenCalled();
    });
    it('keeps failed job evidence for new sync jobs', async () => {
        mocks.queue.getJob.mockResolvedValue(null);
        await new SyncService().runSync('account-1', { types: ['bom'] });
        expect(mocks.queue.add.mock.calls[0][2].removeOnFail).toBe(false);
        expect(mocks.queue.add.mock.calls[0][2].removeOnComplete).toBe(false);
    });
    it('allows scheduled admission after review of legacy and recovery runs', async () => {
        const jobs = ['bom_sync_account-1', 'sync_bom_account-1', 'bom_recovery_account-1'].map(id => {
            const job = { id, data: { accountId: 'account-1' } as any, getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn() };
            job.data.bomReconciliation = { auditId: 'audit', fingerprint: bomExecutionFingerprint(job as any) };
            return job;
        });
        mocks.queue.getJob.mockImplementation(async id => jobs.find(job => job.id === id) ?? null);
        await new SyncService().runSync('account-1', { types: ['bom'], triggerSource: 'SYSTEM' });
        expect(mocks.queue.add).toHaveBeenCalledOnce();
        expect(jobs.every(job => job.remove.mock.calls.length === 1)).toBe(true);
    });
    it('does not let unrelated BOM backlog block order queue admission', async () => {
        mocks.queue.getJob.mockResolvedValue(null);
        mocks.enforceMaxQueueDepth.mockImplementation(async name => { if (name === 'bom-inventory-sync') throw new Error('BOM backlog'); return 0; });
        await new SyncService().runSync('account-1', { types: ['orders'] });
        expect(mocks.enforceMaxQueueDepth).toHaveBeenCalledExactlyOnceWith('sync-orders');
        expect(mocks.queue.add).toHaveBeenCalledOnce();
    });
    it.each(['active', 'completed'])('does not bypass a %s recovery through shared sync dispatch', async state => {
        const recovery = { id: 'bom_recovery_account-1', data: { accountId: 'account-1' }, getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
        mocks.queue.getJob.mockImplementation(async id => id === recovery.id ? recovery : null);
        const run = new SyncService().runSync('account-1', { types: ['bom'] });
        if (state === 'active') await run;
        else await expect(run).rejects.toMatchObject({ code: 'BOM_SYNC_RECONCILIATION_REQUIRED' });
        expect(mocks.queue.add).not.toHaveBeenCalled();
        expect(recovery.remove).not.toHaveBeenCalled();
    });
    it.each([false, true])('scheduled sync honors automatic repair verification (verified=%s)', async verified => {
        const job = { id: 'bom_repair_account-1', processedOn: 100, getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn(),
            data: { accountId: 'account-1', bomRepair: {}, bomRepairResult: { processedOn: 100, total: 2, checked: 2, repaired: 1,
                unchanged: verified ? 1 : 0, failed: verified ? 0 : 1, uncertainWrites: 0, issues: [], verified, auditId: 'audit' } } };
        mocks.queue.getJob.mockImplementation(async id => id === job.id ? job : null);
        const run = new SyncService().runSync('account-1', { types: ['bom'], triggerSource: 'SYSTEM' });
        if (verified) {
            await run; expect(mocks.queue.add).toHaveBeenCalledOnce(); expect(job.remove).toHaveBeenCalledOnce();
        } else {
            await expect(run).rejects.toMatchObject({ code: 'BOM_SYNC_RECONCILIATION_REQUIRED' });
            expect(mocks.queue.add).not.toHaveBeenCalled(); expect(job.remove).not.toHaveBeenCalled();
        }
    });
});
