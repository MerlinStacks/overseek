import { beforeEach, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

const m = vi.hoisted(() => ({ sync: vi.fn(), lease: vi.fn(), cancel: vi.fn(), clear: vi.fn(), plan: vi.fn() }));
vi.mock('../BOMInventorySyncService', () => ({ BOMInventorySyncService: { syncAllBOMProducts: m.sync } }));
vi.mock('../sync/SyncCancellationService', () => ({ SyncCancellationService: { assertNotRequested: m.cancel, clear: m.clear } }));
vi.mock('../queue/JobLease', () => ({ assertJobLease: m.lease }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: { getQueue: () => ({}) }, QUEUES: { BOM_SYNC: 'bom-inventory-sync' } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn() } }));
vi.mock('./BOMSyncRecovery', () => ({ buildBOMRecoveryPlan: m.plan, bomSyncJobIds: () => ['bom_sync_a', 'sync_bom_a', 'bom_recovery_a'] }));
import { processBOMSyncJob } from './processBOMSyncJob';

const targets = [{ productId: 'safe', variationId: 1 }];
const job = () => ({ id: 'bom_recovery_a', queueName: 'bom-inventory-sync', data: { accountId: 'a', bomRecovery: { fingerprint: 'reviewed' } } }) as unknown as Job;
beforeEach(() => {
    vi.resetAllMocks();
    m.plan.mockResolvedValue({ fingerprint: 'reviewed', targets });
    m.sync.mockResolvedValue({ synced: 1, skipped: 0, failed: 0 });
});

it('revalidates the retained source and graph before running only the approved targets', async () => {
    const current = job();
    await processBOMSyncJob(current);
    expect(m.plan).toHaveBeenCalledWith({}, 'a', current.id);
    expect(m.sync).toHaveBeenCalledWith('a', current, expect.objectContaining({ targets }));
    await m.sync.mock.calls[0][2].assertLease();
    expect(m.lease).toHaveBeenCalledTimes(2);
    expect(m.clear).toHaveBeenCalledWith(current.queueName, current.id);
});

it.each(['changed', 'empty', 'unavailable', 'identity'])('does not write when recovery evidence is %s', async failure => {
    const current = job();
    if (failure === 'changed') m.plan.mockResolvedValue({ fingerprint: 'different', targets });
    if (failure === 'empty') m.plan.mockResolvedValue({ fingerprint: 'reviewed', targets: [] });
    if (failure === 'unavailable') m.plan.mockRejectedValue(new Error('Redis unavailable'));
    if (failure === 'identity') current.id = 'other';
    await expect(processBOMSyncJob(current)).rejects.toThrow();
    expect(m.sync).not.toHaveBeenCalled();
    expect(m.clear).toHaveBeenCalledOnce();
});

it('keeps product-level uncertain outcomes failed instead of marking the run safe to replay', async () => {
    m.sync.mockResolvedValue({ synced: 1, skipped: 0, failed: 1 });
    await expect(processBOMSyncJob(job())).rejects.toThrow('uncertain products');
});

it('runs ordinary jobs without a recovery allowlist', async () => {
    const current = job(); current.data = { accountId: 'a' };
    await processBOMSyncJob(current);
    expect(m.plan).not.toHaveBeenCalled();
    expect(m.sync.mock.calls[0][2].targets).toBeUndefined();
});

it('rejects an unscoped job before querying recovery evidence or inventory', async () => {
    const current = job(); current.data.accountId = undefined;
    await expect(processBOMSyncJob(current)).rejects.toThrow('valid account scope');
    expect(m.sync).not.toHaveBeenCalled();
    expect(m.plan).not.toHaveBeenCalled();
});
