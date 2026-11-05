import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
const m = vi.hoisted(() => ({ audit: vi.fn(), commit: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { auditLog: { create: m.audit } } }));
vi.mock('./BOMReviewCommit', () => ({ commitBOMReview: m.commit }));
import { admitBOMRepair, bomRepairEligibility } from './BOMRepairAdmission';
import { bomReviewFingerprint } from './BOMReconciliationEvidence';

function source(id = 'bom_sync_a', state = 'failed'): any {
    return { id, data: { accountId: 'a' }, progress: { current: 367, total: 1908 }, timestamp: 10, processedOn: 11, finishedOn: 20,
        getState: vi.fn(async () => state), remove: vi.fn() };
}
describe('automatic repair admission', () => {
    let jobs: any[]; let queue: Queue;
    let add: ReturnType<typeof vi.fn>;
    const entries = () => Promise.all(jobs.map(async job => ({ job: job as Job, state: await job.getState() })));
    const input = async (confirmedStoppedAndSettled = true) => ({ fingerprint: bomReviewFingerprint(await entries()), confirmedStoppedAndSettled });
    beforeEach(() => {
        vi.resetAllMocks(); jobs = [source()]; add = vi.fn();
        queue = { name: 'bom-inventory-sync', getJob: vi.fn(async id => jobs.find(job => job.id === id)), add } as unknown as Queue;
        m.audit.mockResolvedValue({ id: 'audit' }); m.commit.mockResolvedValue(true);
    });
    it('accepts a legacy run after settlement confirmation without manual inventory notes or a checkpoint', async () => {
        await expect(admitBOMRepair(queue, 'a', 'operator', await input())).resolves.toEqual({ status: 'queued', jobId: 'bom_repair_a' });
        expect(add).toHaveBeenCalledWith('bom-inventory-sync', expect.objectContaining({ accountId: 'a', bomRepair: expect.objectContaining({ requestedBy: 'operator', confirmedStoppedAndSettled: true }) }), expect.objectContaining({ jobId: 'bom_repair_a', attempts: 1, removeOnComplete: false, removeOnFail: false }));
        expect(jobs[0].remove).not.toHaveBeenCalled();
    });
    it('does not mistake a failed state or expired lock for proof that old HTTP writes settled', async () => {
        await expect(admitBOMRepair(queue, 'a', 'operator', await input(false))).rejects.toMatchObject({ code: 'BOM_REPAIR_SETTLEMENT_REQUIRED' });
        expect(add).not.toHaveBeenCalled();
    });
    it('requires settlement confirmation for completed legacy jobs with recorded failures too', async () => {
        jobs[0].getState.mockResolvedValue('completed'); jobs[0].progress.failed = 1;
        expect(bomRepairEligibility(await entries(), 'a')).toMatchObject({ canStart: true, requiresStoppedConfirmation: true });
        await expect(admitBOMRepair(queue, 'a', 'operator', await input(false))).rejects.toMatchObject({ code: 'BOM_REPAIR_SETTLEMENT_REQUIRED' });
        await expect(admitBOMRepair(queue, 'a', 'operator', await input(true))).resolves.toMatchObject({ status: 'queued' });
        expect(jobs[0].remove).not.toHaveBeenCalled();
    });
    it.each(['active', 'waiting', 'prioritized', 'delayed', 'waiting-children', 'unknown'])('refuses %s work even with confirmation', async state => {
        jobs.push(source('sync_bom_a', state));
        await expect(admitBOMRepair(queue, 'a', 'operator', await input())).rejects.toMatchObject({ code: 'BOM_REPAIR_NOT_STOPPED' });
        expect(add).not.toHaveBeenCalled();
    });
    it('rejects stale fingerprints and foreign-account jobs', async () => {
        const old = await input(); jobs[0].progress.current++;
        await expect(admitBOMRepair(queue, 'a', 'operator', old)).rejects.toMatchObject({ code: 'BOM_REPAIR_CHANGED' });
        jobs[0].data.accountId = 'other';
        await expect(admitBOMRepair(queue, 'a', 'operator', await input())).rejects.toThrow('ownership');
    });
    function previousRepair(uncertainWrites = 0) {
        const repair = source('bom_repair_a', 'completed');
        repair.data.bomRepair = { confirmedStoppedAndSettled: true, sourceFingerprint: bomReviewFingerprint([{ job: jobs[0], state: 'failed' }]) };
        repair.data.bomRepairResult = { total: 2, checked: 2, repaired: 1, unchanged: 0, failed: 1, uncertainWrites, issues: [], verified: false, processedOn: repair.processedOn, auditId: 'audit-old' };
        jobs.push(repair); return repair;
    }
    it('reuses source settlement evidence after a completed report with no uncertain writes', async () => {
        const repair = previousRepair();
        expect(bomRepairEligibility(await entries(), 'a').requiresStoppedConfirmation).toBe(false);
        await admitBOMRepair(queue, 'a', 'operator', await input(false));
        expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.commit.mock.invocationCallOrder[0]);
        expect(m.commit.mock.invocationCallOrder[0]).toBeLessThan(repair.remove.mock.invocationCallOrder[0]);
        expect(repair.remove).toHaveBeenCalledOnce();
        expect(jobs[0].remove).not.toHaveBeenCalled();
    });
    it('requires renewed confirmation for an unacknowledged repair write', async () => {
        previousRepair(1);
        await expect(admitBOMRepair(queue, 'a', 'operator', await input(false))).rejects.toMatchObject({ code: 'BOM_REPAIR_SETTLEMENT_REQUIRED' });
    });
    it('does not remove a prior repair if archival or the atomic slot claim fails', async () => {
        const repair = previousRepair(); m.commit.mockResolvedValue(false);
        await expect(admitBOMRepair(queue, 'a', 'operator', await input())).rejects.toMatchObject({ code: 'BOM_REPAIR_CHANGED' });
        expect(repair.remove).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
        m.audit.mockRejectedValue(new Error('DB down'));
        await expect(admitBOMRepair(queue, 'a', 'operator', await input())).rejects.toThrow('DB down');
        expect(repair.remove).not.toHaveBeenCalled();
    });
    it('never steals an in-progress admission claim, even after its queue lock expired', async () => {
        const repair = previousRepair(); repair.data.bomRepairAdmissionClaim = 'another-request';
        await expect(admitBOMRepair(queue, 'a', 'operator', await input())).rejects.toMatchObject({ code: 'BOM_REPAIR_ADMISSION_PENDING' });
        expect(m.commit).not.toHaveBeenCalled(); expect(repair.remove).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
    });
});
