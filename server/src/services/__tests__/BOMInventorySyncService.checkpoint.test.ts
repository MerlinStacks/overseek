import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ boms: vi.fn(), cancellation: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { bOM: { findMany: m.boms } } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../StockValidationService', () => ({ StockValidationService: {} }));
vi.mock('../woo', () => ({ WooService: {} }));
vi.mock('../sync/SyncCancellationService', () => ({ SyncCancellationService: { assertNotRequested: m.cancellation } }));
import { BOMInventorySyncService } from '../BOMInventorySyncService';
import { JobLeaseLostError } from '../queue/JobLease';
import { readBOMCheckpoint } from '../bom/BOMSyncCheckpoint';

const targets = ['p1', 'p2', 'p3'].map(productId => ({ productId, variationId: 0 }));
function queueJob() {
    const job = {
        id: 'job', queueName: 'bom-inventory-sync', data: { accountId: 'a' } as any, progress: null as any,
        updateData: vi.fn(async (data: any) => { job.data = structuredClone(data); }),
        updateProgress: vi.fn(async (progress: any) => { job.progress = structuredClone(progress); })
    };
    return job;
}
beforeEach(() => { vi.clearAllMocks(); m.boms.mockResolvedValue(targets); });
afterEach(() => vi.restoreAllMocks());

it('persists the full manifest and an in-flight checkpoint before each product, then settles acknowledged results', async () => {
    const job = queueJob();
    const sync = vi.spyOn(BOMInventorySyncService, 'syncProductToWoo').mockImplementation(async (_, productId) => {
        const saved = readBOMCheckpoint(job.data, job.progress)!;
        expect(saved.targets).toEqual(targets);
        expect(saved.targets[saved.checkpoint.inFlightIndex!].productId).toBe(productId);
        return { success: productId !== 'p2', productId, wooId: 1, previousStock: 1, newStock: 2 };
    });
    await BOMInventorySyncService.syncAllBOMProducts('a', job, { assertLease: vi.fn() });
    expect(sync).toHaveBeenCalledTimes(3);
    expect(readBOMCheckpoint(job.data, job.progress)?.checkpoint).toEqual({ version: 1, nextIndex: 3, inFlightIndex: null, uncertainIndexes: [1] });
});

it('retains the exact interrupted product on lock loss and never starts later products', async () => {
    const job = queueJob();
    const sync = vi.spyOn(BOMInventorySyncService, 'syncProductToWoo')
        .mockResolvedValueOnce({ success: true, productId: 'p1', wooId: 1, previousStock: 1, newStock: 2 })
        .mockRejectedValueOnce(new JobLeaseLostError());
    await expect(BOMInventorySyncService.syncAllBOMProducts('a', job, { assertLease: vi.fn() })).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(readBOMCheckpoint(job.data, job.progress)?.checkpoint).toEqual({ version: 1, nextIndex: 1, inFlightIndex: 1, uncertainIndexes: [] });
});

it('does not start a product if its durable in-flight marker cannot be saved', async () => {
    const job = queueJob();
    job.updateProgress.mockImplementation(async progress => {
        if (progress.checkpoint.inFlightIndex !== null) throw new Error('Redis down');
    });
    const sync = vi.spyOn(BOMInventorySyncService, 'syncProductToWoo');
    await expect(BOMInventorySyncService.syncAllBOMProducts('a', job, { assertLease: vi.fn() })).rejects.toThrow('Redis down');
    expect(sync).not.toHaveBeenCalled();
});

it('limits a continuation to its allowlist and requests live stock and write acknowledgement', async () => {
    const job = queueJob();
    const sync = vi.spyOn(BOMInventorySyncService, 'syncProductToWoo').mockResolvedValue({ success: true, productId: 'p3', wooId: 1, previousStock: 1, newStock: 2 });
    await BOMInventorySyncService.syncAllBOMProducts('a', job, { assertLease: vi.fn(), targets: [targets[2]] });
    expect(sync).toHaveBeenCalledExactlyOnceWith('a', 'p3', 0, expect.objectContaining({ requireLiveStock: true }));
    expect(job.data.bomManifest.targets).toEqual([targets[2]]);
});

it('refuses to replay an already initialized occurrence', async () => {
    const job = queueJob(); job.data.bomManifest = { version: 1, targets };
    const sync = vi.spyOn(BOMInventorySyncService, 'syncProductToWoo');
    await expect(BOMInventorySyncService.syncAllBOMProducts('a', job, { assertLease: vi.fn() })).rejects.toThrow('not replay');
    expect(sync).not.toHaveBeenCalled();
});
