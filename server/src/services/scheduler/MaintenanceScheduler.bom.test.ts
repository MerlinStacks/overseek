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
beforeEach(() => {
    vi.resetAllMocks();
    m.findMany.mockResolvedValue([{ product: { accountId: 'a' } }]);
});

it.each([
    ['bom_sync_a', 'failed'], ['sync_bom_a', 'failed'], ['bom_recovery_a', 'active'],
    ['bom_recovery_a', 'completed'], ['sync_bom_a', 'prioritized']
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
