import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
const m = vi.hoisted(() => ({ boms: vi.fn(), bom: vi.fn(), audit: vi.fn(), auditUpdate: vi.fn(), sync: vi.fn(), permission: vi.fn(), lease: vi.fn(), cancel: vi.fn(), commit: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { bOM: { findMany: m.boms, findUnique: m.bom }, auditLog: { create: m.audit, update: m.auditUpdate } } }));
vi.mock('../BOMInventorySyncService', () => ({ BOMInventorySyncService: { syncProductToWoo: m.sync } }));
vi.mock('../PermissionService', () => ({ PermissionService: { hasPermission: m.permission } }));
vi.mock('../queue/JobLease', async importOriginal => ({ ...await importOriginal<object>(), assertJobLease: m.lease }));
vi.mock('../sync/SyncCancellationService', () => ({ SyncCancellationService: { assertNotRequested: m.cancel, isCancellation: () => false } }));
vi.mock('./BOMReviewCommit', () => ({ commitBOMReview: m.commit }));
import { processBOMRepairJob } from './processBOMRepairJob';
import { bomReviewFingerprint, isBOMJobReconciled } from './BOMReconciliationEvidence';
import { isVerifiedBOMRepair } from './BOMRepairState';
import { JobLeaseLostError } from '../queue/JobLease';

function bom(productId: string, childProductId = 'leaf'): any {
    return { productId, variationId: 0, product: { id: productId, accountId: 'a', wooId: 10, name: productId, sku: productId.toUpperCase() },
        items: [{ id: productId, childProductId, childVariationId: null, childVariation: null, internalProductId: null, supplierItemId: null, quantity: 1, wasteFactor: 0 }] };
}
describe('fresh-stock BOM repair worker', () => {
    let rows: any[]; let source: any; let job: any; let queue: Queue;
    beforeEach(() => {
        vi.resetAllMocks(); rows = [bom('parent', 'child'), bom('child'), bom('safe')];
        source = { id: 'bom_sync_a', data: { accountId: 'a' }, progress: { current: 367, total: 1908 }, getState: vi.fn(async () => 'failed'), timestamp: 1, processedOn: 2, finishedOn: 3 };
        job = { id: 'bom_repair_a', queueName: 'bom-inventory-sync', processedOn: 100, timestamp: 90,
            data: { accountId: 'a', bomRepair: { requestedBy: 'operator', confirmedStoppedAndSettled: true, sourceFingerprint: bomReviewFingerprint([{ job: source, state: 'failed' }]) } },
            getState: vi.fn(async () => 'active'),
            updateData: vi.fn(async (data: any) => { job.data = structuredClone(data); }),
            updateProgress: vi.fn(async (progress: any) => { job.progress = structuredClone(progress); }) };
        queue = { getJob: vi.fn(async id => id === source.id ? source : id === job.id ? job : null) } as unknown as Queue;
        m.permission.mockResolvedValue(true); m.audit.mockResolvedValue({ id: 'audit' });
        m.boms.mockImplementation(async () => structuredClone(rows));
        m.bom.mockImplementation(async ({ where }) => rows.find(row => row.productId === where.productId_variationId.productId));
        m.commit.mockImplementation(async (_, target, data) => { target.data = structuredClone(data); return true; });
        m.sync.mockImplementation(async (_, productId, __, options) => { await options.beforeWrite(); return { success: true, previousStock: 100, newStock: 98, productId }; });
    });
    it('repairs the entire current catalogue despite a legacy counter-only source, then archives and unlocks', async () => {
        const result = await processBOMRepairJob(job as Job, queue);
        expect(result).toMatchObject({ total: 3, checked: 3, repaired: 3, failed: 0, verified: true });
        const order = m.sync.mock.calls.map(call => call[1]);
        expect(order.indexOf('child')).toBeLessThan(order.indexOf('parent'));
        expect(m.sync.mock.calls.every(call => call[3].requireLiveStock === true && call[3].repairMode === true)).toBe(true);
        expect(isBOMJobReconciled(source)).toBe(true);
        expect(isVerifiedBOMRepair(job)).toBe(true);
        expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.commit.mock.invocationCallOrder[0]);
        expect(m.auditUpdate).toHaveBeenCalledWith({ where: { id: 'audit' }, data: { details: expect.objectContaining({ releasePending: false, result: expect.objectContaining({ verified: true, auditId: 'audit' }), manifest: expect.objectContaining({ targets: expect.any(Array) }) }) } });
        expect(job.progress).toMatchObject({ current: 3, total: 3, failed: 0, checkpoint: { nextIndex: 3, inFlightIndex: null } });
    });
    it('processes unaffected products while reporting failed components and quarantining downstream BOMs', async () => {
        m.sync.mockImplementation(async (_, productId, __, options) => {
            await options.beforeWrite();
            return productId === 'child' ? { success: false, error: 'BOM_REPAIR_TARGET_INVALID', writeUncertain: false }
                : { success: true, previousStock: 98, newStock: 98, localDbUpdated: true };
        });
        const result = await processBOMRepairJob(job as Job, queue);
        expect(result).toMatchObject({ checked: 3, failed: 2, unchanged: 1, verified: false, uncertainWrites: 0 });
        expect(result.issues.map(issue => issue.productId)).toEqual(['child', 'parent']);
        expect(result.issues[1].code).toBe('BOM_REPAIR_DEPENDENCY');
        expect(m.sync.mock.calls.map(call => call[1])).toEqual(['child', 'safe']);
        expect(m.commit).not.toHaveBeenCalled(); expect(isVerifiedBOMRepair(job)).toBe(false);
    });
    it('keeps ambiguous write outcomes in the report instead of silently clearing them', async () => {
        m.sync.mockResolvedValue({ success: false, error: 'ETIMEDOUT https://secret:password@store', writeUncertain: true });
        const result = await processBOMRepairJob(job as Job, queue);
        expect(result.uncertainWrites).toBe(2);
        expect(JSON.stringify(result)).not.toContain('password');
        expect(m.commit).not.toHaveBeenCalled();
    });
    it('does not write cycle targets or their dependents', async () => {
        rows = [bom('a', 'b'), bom('b', 'a'), bom('parent', 'a'), bom('safe')];
        const result = await processBOMRepairJob(job as Job, queue);
        expect(m.sync.mock.calls.map(call => call[1])).toEqual(['safe']);
        expect(result.failed).toBe(3); expect(result.issues.every(issue => issue.code === 'BOM_REPAIR_CYCLE')).toBe(true);
    });
    it('stops before a write when the lease is lost', async () => {
        m.sync.mockImplementation(async (_, __, ___, options) => { m.lease.mockRejectedValue(new JobLeaseLostError()); await options.beforeWrite(); });
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toBeInstanceOf(JobLeaseLostError);
        expect(m.sync).toHaveBeenCalledOnce(); expect(m.commit).not.toHaveBeenCalled();
        expect(job.progress.checkpoint.inFlightIndex).toBe(0);
    });
    it('stops when source evidence changes rather than approving a new occurrence', async () => {
        m.sync.mockImplementation(async (_, __, ___, options) => { source.processedOn++; await options.beforeWrite(); });
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toMatchObject({ code: 'BOM_REPAIR_CHANGED' });
        expect(m.commit).not.toHaveBeenCalled();
    });
    it('does not unlock when definitions changed or the audit archive could not be saved', async () => {
        m.boms.mockResolvedValueOnce(structuredClone(rows)).mockResolvedValueOnce([bom('different')]);
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toThrow('BOM_REPAIR_DEFINITION_CHANGED');
        expect(m.commit).not.toHaveBeenCalled();
    });
    it('does not mark source jobs safe if durable audit storage fails', async () => {
        m.audit.mockRejectedValue(new Error('DB down'));
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toThrow('DB down');
        expect(m.commit).not.toHaveBeenCalled(); expect(isBOMJobReconciled(source)).toBe(false);
    });
    it('does not release sources if a definition changes while the archive is saved', async () => {
        m.audit.mockImplementation(async () => { rows[0].items[0].quantity = 2; return { id: 'audit' }; });
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toThrow('BOM_REPAIR_DEFINITION_CHANGED');
        expect(m.commit).not.toHaveBeenCalled();
        expect(isVerifiedBOMRepair(job)).toBe(false);
    });
    it('does not publish success if a definition changes during final audit persistence', async () => {
        m.auditUpdate.mockImplementation(async () => { rows[0].items[0].quantity = 2; });
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toThrow('BOM_REPAIR_DEFINITION_CHANGED');
        expect(isVerifiedBOMRepair(job)).toBe(false);
    });
    it('does not publish a verified repair if the final durable report cannot be saved', async () => {
        m.auditUpdate.mockRejectedValue(new Error('Final archive unavailable'));
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toThrow('Final archive unavailable');
        expect(job.data.bomRepairResult).toBeUndefined();
        expect(isVerifiedBOMRepair(job)).toBe(false);
    });
    it('rechecks operator permission and refuses an initialized repair replay', async () => {
        m.permission.mockResolvedValue(false);
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toThrow('permission');
        expect(m.sync).not.toHaveBeenCalled();
        job.data.bomManifest = { version: 1, targets: [] };
        await expect(processBOMRepairJob(job as Job, queue)).rejects.toThrow('must not be replayed');
    });
});
