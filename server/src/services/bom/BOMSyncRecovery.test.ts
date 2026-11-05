import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { bOM: { findMany: mocks.findMany } } }));
import { buildBOMRecoveryPlan, bomSyncJobIds } from './BOMSyncRecovery';
import { readBOMCheckpoint } from './BOMSyncCheckpoint';

const targets = ['done', 'uncertain', 'safe', 'dependent', 'indirect', 'removed'].map(productId => ({ productId, variationId: 0 }));
function failedJob() {
    return {
        id: 'bom_sync_account', timestamp: 100, processedOn: 110, finishedOn: 200, failedReason: 'lock lost',
        data: { accountId: 'account', bomManifest: { version: 1, targets } },
        progress: { checkpoint: { version: 1, nextIndex: 1, inFlightIndex: 1, uncertainIndexes: [] as number[] } },
        getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn()
    };
}

describe('BOM recovery evidence', () => {
    let job: ReturnType<typeof failedJob>;
    let queue: Queue;
    let getJob: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.clearAllMocks();
        job = failedJob();
        getJob = vi.fn(async id => id === job.id ? job : null);
        queue = { getJob } as unknown as Queue;
        mocks.findMany.mockResolvedValue([
            ...targets.filter(target => target.productId !== 'removed').map(target => ({ ...target, items: target.productId === 'dependent' ? [{ childProductId: 'uncertain' }] : target.productId === 'indirect' ? [{ childProductId: 'dependent' }] : [] }))
        ]);
    });

    it('continues only provably unattempted targets, excluding uncertain stock and downstream dependencies', async () => {
        const plan = await buildBOMRecoveryPlan(queue, 'account');
        expect(plan.targets).toEqual([{ productId: 'safe', variationId: 0 }]);
        expect(plan).toMatchObject({ eligibleProducts: 1, uncertainProducts: 1, excludedProducts: 3, sourceJobIds: [job.id] });
        expect(job.remove).not.toHaveBeenCalled();
    });

    it('quarantines prior failed targets as well as the current in-flight target', async () => {
        job.progress.checkpoint.uncertainIndexes = [0];
        mocks.findMany.mockResolvedValue([{ productId: 'safe', variationId: 0, items: [{ childProductId: 'done' }] }]);
        expect((await buildBOMRecoveryPlan(queue, 'account')).targets).toEqual([]);
    });

    it('intersects unattempted targets across both failed job IDs', async () => {
        const other = failedJob(); other.id = 'sync_bom_account';
        other.progress.checkpoint.nextIndex = 3; other.progress.checkpoint.inFlightIndex = 3;
        getJob.mockImplementation(async id => id === job.id ? job : id === other.id ? other : null);
        expect((await buildBOMRecoveryPlan(queue, 'account')).targets).toEqual([]);
    });

    it('rejects legacy counter-only evidence without querying or guessing the remaining products', async () => {
        job.progress = { current: 367, total: 1908 } as any;
        await expect(buildBOMRecoveryPlan(queue, 'account')).rejects.toMatchObject({ code: 'BOM_RECOVERY_LEGACY_CHECKPOINT' });
        expect(mocks.findMany).not.toHaveBeenCalled();
    });

    it.each(['active', 'waiting', 'prioritized', 'delayed', 'waiting-children'])('rejects %s work even alongside a failed job', async state => {
        const other = failedJob(); other.id = 'sync_bom_account'; other.getState.mockResolvedValue(state);
        getJob.mockImplementation(async id => id === job.id ? job : id === other.id ? other : null);
        await expect(buildBOMRecoveryPlan(queue, 'account')).rejects.toThrow('still running');
    });

    it('checks ownership even when account IDs normalize to the same job ID', async () => {
        job.data.accountId = 'different-account';
        await expect(buildBOMRecoveryPlan(queue, 'account')).rejects.toThrow('ownership');
    });

    it('does not approve an incomplete execution identity', async () => {
        job.processedOn = undefined as any;
        await expect(buildBOMRecoveryPlan(queue, 'account')).rejects.toThrow('identity is incomplete');
    });

    it.each(['failed', 'completed'])('preserves an existing %s continuation instead of creating another', async state => {
        const recovery = failedJob(); recovery.id = bomSyncJobIds('account')[2]; recovery.getState.mockResolvedValue(state);
        getJob.mockImplementation(async id => id === job.id ? job : id === recovery.id ? recovery : null);
        await expect(buildBOMRecoveryPlan(queue, 'account')).rejects.toThrow('already been attempted');
    });

    it('binds approval to the exact failed occurrence, checkpoint and current dependency graph', async () => {
        const first = await buildBOMRecoveryPlan(queue, 'account');
        expect((await buildBOMRecoveryPlan(queue, 'account')).fingerprint).toBe(first.fingerprint);
        job.processedOn++;
        expect((await buildBOMRecoveryPlan(queue, 'account')).fingerprint).not.toBe(first.fingerprint);
        const second = await buildBOMRecoveryPlan(queue, 'account');
        mocks.findMany.mockResolvedValue([{ productId: 'safe', variationId: 0, items: [{ childProductId: 'uncertain' }] }]);
        expect((await buildBOMRecoveryPlan(queue, 'account')).fingerprint).not.toBe(second.fingerprint);
    });

    it.each([
        { version: 1, nextIndex: 7, inFlightIndex: null, uncertainIndexes: [] },
        { version: 1, nextIndex: 1, inFlightIndex: 2, uncertainIndexes: [] },
        { version: 1, nextIndex: 1, inFlightIndex: 1, uncertainIndexes: [1] },
        { version: 1, nextIndex: 2, inFlightIndex: null, uncertainIndexes: [0, 0] }
    ])('rejects malformed checkpoint %j', checkpoint => {
        expect(readBOMCheckpoint(job.data, { checkpoint })).toBeNull();
    });
});
