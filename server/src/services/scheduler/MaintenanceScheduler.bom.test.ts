import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findMany: vi.fn(), getJob: vi.fn(), add: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { bOM: { findMany: m.findMany } } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../JanitorService', () => ({ JanitorService: {} }));
vi.mock('../queue/QueueFactory', () => ({
    QueueFactory: { createQueue: () => ({}), getQueue: () => ({ getJob: m.getJob, add: m.add }) },
    QUEUES: { BOM_SYNC: 'bom-inventory-sync' }
}));
import { MaintenanceScheduler } from './MaintenanceScheduler';
import { bomExecutionFingerprint } from '../bom/BOMReconciliationEvidence';
beforeEach(() => {
    vi.resetAllMocks();
    m.findMany.mockResolvedValue([{ product: { accountId: 'a' } }]);
});

it.each([
    ['bom_sync_a', 'failed'], ['sync_bom_a', 'failed'], ['bom_recovery_a', 'active'],
    ['bom_recovery_a', 'completed'], ['sync_bom_a', 'prioritized'], ['bom_repair_a', 'active'], ['bom_repair_a', 'completed']
])('does not erase or bypass retained %s work in state %s', async (id, state) => {
    const job = { data: { accountId: 'a' }, getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
    m.getJob.mockImplementation(async key => key === id ? job : null);
    await MaintenanceScheduler.dispatchBOMInventorySync();
    expect(job.remove).not.toHaveBeenCalled();
    expect(m.add).not.toHaveBeenCalled();
});

it('retains failed evidence for newly scheduled work', async () => {
    m.getJob.mockResolvedValue(null);
    await MaintenanceScheduler.dispatchBOMInventorySync();
    expect(m.add).toHaveBeenCalledWith('bom-inventory-sync', { accountId: 'a' }, expect.objectContaining({ removeOnComplete: false, removeOnFail: false }));
});
it('preserves a completed legacy run with recorded product failures', async () => {
    const job = { data: { accountId: 'a' }, progress: { failed: 1 }, getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn() };
    m.getJob.mockImplementation(async id => id === 'bom_sync_a' ? job : null);
    await MaintenanceScheduler.dispatchBOMInventorySync();
    expect(m.add).not.toHaveBeenCalled(); expect(job.remove).not.toHaveBeenCalled();
});
it('resumes the hourly path after source archival and a verified automatic repair', async () => {
    const source = { id: 'bom_sync_a', data: { accountId: 'a' } as any, getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn() };
    source.data.bomReconciliation = { auditId: 'audit', fingerprint: bomExecutionFingerprint(source as any) };
    const repair = { id: 'bom_repair_a', processedOn: 100, getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn(),
        data: { accountId: 'a', bomRepair: {}, bomRepairResult: { processedOn: 100, total: 2, checked: 2, repaired: 1,
            unchanged: 1, failed: 0, uncertainWrites: 0, issues: [], verified: true, auditId: 'audit' } } };
    m.getJob.mockImplementation(async id => id === source.id ? source : id === repair.id ? repair : null);
    await MaintenanceScheduler.dispatchBOMInventorySync();
    expect(m.add).toHaveBeenCalledOnce();
    expect(source.remove).toHaveBeenCalledOnce(); expect(repair.remove).toHaveBeenCalledOnce();
});
