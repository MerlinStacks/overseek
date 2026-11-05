import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

const m = vi.hoisted(() => ({ archive: vi.fn(), products: vi.fn(), commit: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { auditLog: { create: m.archive }, wooProduct: { findMany: m.products } } }));
vi.mock('./BOMReviewCommit', () => ({ commitBOMReview: m.commit }));
import { reconcileBOMInventory } from './BOMReconciliation';
import { getBOMSyncDiagnostics } from './BOMSyncDiagnostics';
import { bomExecutionFingerprint, bomReviewFingerprint, isBOMJobReconciled } from './BOMReconciliationEvidence';

function jobFixture(id = 'bom_sync_account', state = 'failed') {
    const job = {
        id, data: { accountId: 'account' } as any, timestamp: 100, processedOn: 110, finishedOn: 200,
        attemptsMade: 1, failedReason: 'job stalled more than allowable limit', progress: { current: 367, total: 1908 } as any,
        getState: vi.fn(async () => state), remove: vi.fn(),
        updateData: vi.fn(async (data: any) => { job.data = structuredClone(data); })
    };
    return job;
}
const review = { notes: 'Reviewed every BOM and component against live and physical stock.', confirmedStoppedAndSettled: true as const, confirmedInventoryReviewed: true as const };

describe('BOM inventory reconciliation', () => {
    let jobs: ReturnType<typeof jobFixture>[];
    let queue: Queue;
    const entries = () => Promise.all(jobs.map(async job => ({ job: job as any, state: await job.getState() })));
    const fingerprint = async () => bomReviewFingerprint(await entries());
    beforeEach(() => {
        vi.resetAllMocks();
        jobs = [jobFixture()];
        queue = { getJob: vi.fn(async id => jobs.find(job => job.id === id) ?? null) } as unknown as Queue;
        m.archive.mockResolvedValue({ id: 'audit-1' });
        m.products.mockResolvedValue([{ id: 'parent', name: 'Chopping board', sku: 'BOARD' }]);
        m.commit.mockImplementation(async (_, job, data) => { job.data = structuredClone(data); return true; });
    });

    it('archives legacy counter-only evidence before releasing the exact run, without deleting or replaying it', async () => {
        const result = await reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: await fingerprint() });
        expect(result).toEqual({ success: true, auditId: 'audit-1' });
        expect(m.archive).toHaveBeenCalledWith({ data: expect.objectContaining({
            accountId: 'account', userId: 'operator', action: 'BOM_INVENTORY_RECONCILED',
            details: expect.objectContaining({ notes: review.notes, executions: [expect.objectContaining({
                id: jobs[0].id, manifest: null, progress: expect.objectContaining({ current: 367, total: 1908, checkpoint: null })
            })] })
        }) });
        expect(m.archive.mock.invocationCallOrder[0]).toBeLessThan(m.commit.mock.invocationCallOrder[0]);
        expect(isBOMJobReconciled(jobs[0] as any)).toBe(true);
        expect(jobs[0].remove).not.toHaveBeenCalled();
        jobs[0].processedOn++;
        expect(isBOMJobReconciled(jobs[0] as any)).toBe(false);
    });

    it('preserves the block if durable audit storage is unavailable', async () => {
        m.archive.mockRejectedValue(new Error('DB down'));
        await expect(reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: await fingerprint() })).rejects.toThrow('DB down');
        expect(jobs[0].updateData).not.toHaveBeenCalled();
        expect(m.commit).not.toHaveBeenCalled();
    });
    it('can explicitly reconcile an older completed run with failed product counts', async () => {
        jobs[0].getState.mockResolvedValue('completed'); jobs[0].progress.failed = 1;
        await reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: await fingerprint() });
        expect(isBOMJobReconciled(jobs[0] as any)).toBe(true);
        expect(m.commit).toHaveBeenCalledOnce();
    });

    it.each(['active', 'waiting', 'prioritized', 'delayed', 'waiting-children', 'unknown'])('refuses %s jobs even with operator confirmation', async state => {
        jobs.push(jobFixture('sync_bom_account', state));
        await expect(reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: await fingerprint() })).rejects.toMatchObject({ code: 'BOM_REVIEW_NOT_STOPPED' });
        expect(m.archive).not.toHaveBeenCalled();
    });

    it('rejects stale reviews and foreign-account evidence', async () => {
        const previous = await fingerprint();
        jobs[0].progress.current++;
        await expect(reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: previous })).rejects.toMatchObject({ code: 'BOM_REVIEW_CHANGED' });
        jobs[0].data.accountId = 'other';
        await expect(getBOMSyncDiagnostics(queue, 'account')).rejects.toThrow('ownership');
        expect(m.archive).not.toHaveBeenCalled();
    });

    it('does not apply review if an execution changes while archiving', async () => {
        m.archive.mockImplementation(async () => { jobs[0].processedOn++; return { id: 'audit-1' }; });
        await expect(reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: await fingerprint() })).rejects.toMatchObject({ code: 'BOM_REVIEW_CHANGED' });
        expect(jobs[0].updateData).not.toHaveBeenCalled();
        expect(m.commit).not.toHaveBeenCalled();
    });

    it('fails closed if the atomic evidence comparison detects a reused or changed job', async () => {
        m.commit.mockResolvedValue(false);
        await expect(reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: await fingerprint() })).rejects.toMatchObject({ code: 'BOM_REVIEW_CHANGED' });
        expect(isBOMJobReconciled(jobs[0] as any)).toBe(false);
        expect(jobs[0].remove).not.toHaveBeenCalled();
    });

    it('reconciles both legacy/shared failures and a completed continuation together', async () => {
        jobs.push(jobFixture('sync_bom_account'), jobFixture('bom_recovery_account', 'completed'));
        jobs[2].data.bomRecovery = { fingerprint: 'old-plan' };
        await reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: await fingerprint() });
        expect(jobs.every(job => isBOMJobReconciled(job as any))).toBe(true);
        expect((await getBOMSyncDiagnostics(queue, 'account')).runs).toEqual([]);
    });

    it('reports identities only from checkpoints, scopes product lookup, and does not leak provider secrets', async () => {
        jobs[0].data.bomManifest = { version: 1, targets: [{ productId: 'parent', variationId: 54535 }] };
        jobs[0].progress = { checkpoint: { version: 1, nextIndex: 0, inFlightIndex: 0, uncertainIndexes: [] } };
        jobs[0].failedReason = '401 https://secret:password@store.invalid/?consumer_key=private';
        const result = await getBOMSyncDiagnostics(queue, 'account');
        expect(result.runs[0]).toMatchObject({ hasCheckpoint: true, affectedCount: 1, cause: expect.stringContaining('API key'), products: [expect.objectContaining({ name: 'Chopping board', sku: 'BOARD', variationId: 54535 })] });
        expect(m.products).toHaveBeenCalledWith({ where: { accountId: 'account', id: { in: ['parent'] } }, select: { id: true, name: true, sku: true } });
        expect(JSON.stringify(result)).not.toContain('private');
        await reconcileBOMInventory(queue, 'account', 'operator', { ...review, fingerprint: result.fingerprint });
        expect(JSON.stringify(m.archive.mock.calls)).not.toContain('private');
    });

    it('explicitly identifies missing checkpoints without guessing products from counters', async () => {
        const result = await getBOMSyncDiagnostics(queue, 'account');
        expect(result.runs[0]).toMatchObject({ hasCheckpoint: false, products: [] });
        expect(m.products).not.toHaveBeenCalled();
        expect(jobs[0].updateData).not.toHaveBeenCalled();
    });

    it('does not treat a marker for a different occurrence as reconciled', () => {
        jobs[0].data.bomReconciliation = { auditId: 'audit', fingerprint: bomExecutionFingerprint(jobs[0] as any) };
        expect(isBOMJobReconciled(jobs[0] as any)).toBe(true);
        jobs[0].progress.current++;
        expect(isBOMJobReconciled(jobs[0] as any)).toBe(false);
    });
});
