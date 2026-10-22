import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), remove: vi.fn(), order: vi.fn(), index: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { orderTagIndexOutbox: { findMany: m.find, updateMany: m.update, deleteMany: m.remove }, wooOrder: { findFirst: m.order } } }));
vi.mock('../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
vi.mock('./search/IndexingService', () => ({ IndexingService: { indexOrder: m.index } }));
import { drainOrderTagIndexes } from './OrderTagIndexOutbox';
beforeEach(() => { vi.clearAllMocks(); m.find.mockResolvedValue([{ orderId: 'o', accountId: 'a', revision: 1, attempts: 0 }]); m.update.mockResolvedValue({ count: 1 }); m.remove.mockResolvedValue({ count: 1 }); m.order.mockResolvedValue({ wooId: 1, rawData: { tags: ['current'], status: 'processing' } }); m.index.mockResolvedValue({}); });
it('indexes a fresh account-bound snapshot and deletes only the claimed revision', async () => {
    await drainOrderTagIndexes(); expect(m.order).toHaveBeenCalledWith({ where: { id: 'o', accountId: 'a' } }); expect(m.index.mock.calls[0][2]).toEqual(['current']); expect(m.index.mock.calls[0][4]).toBeInstanceOf(AbortSignal);
    expect(m.remove).toHaveBeenCalledWith({ where: expect.objectContaining({ orderId: 'o', accountId: 'a', revision: 1, leaseOwner: expect.any(String) }) });
});
it('keeps failed indexing durable and releases the lease for bounded retries', async () => { m.index.mockRejectedValue(Error('offline')); await drainOrderTagIndexes(); expect(m.remove).not.toHaveBeenCalled(); expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ attempts: { increment: 1 }, leaseOwner: null }) })); });
it('does not erase a newer intent written during indexing', async () => { m.remove.mockResolvedValue({ count: 0 }); await drainOrderTagIndexes(); expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { leaseOwner: null, leaseUntil: null } })); });
