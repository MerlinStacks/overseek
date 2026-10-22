import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn(), update: vi.fn(), lock: vi.fn() }));
vi.mock('../../utils/prisma', () => { const tx = { $queryRaw: m.lock, adCopyGenerationQuota: { findUnique: m.find, upsert: m.upsert, updateMany: m.update } }; return { prisma: { ...tx, $transaction: async (run: (db: unknown) => unknown) => run(tx) } }; });
import { claimAdCopyGeneration } from './AdCopyQuota';
beforeEach(() => { vi.clearAllMocks(); m.find.mockResolvedValue(null); });
it('persists charged work before generation and releases only its own lease', async () => { const release = await claimAdCopyGeneration('a', 2); expect(m.upsert.mock.calls[0][0].create).toMatchObject({ accountId: 'a', units: 2 }); await release(); expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', leaseOwner: expect.any(String) } })); });
it('refuses active work and an exhausted hourly budget without refunding ambiguous work', async () => {
    m.find.mockResolvedValue({ leaseUntil: new Date(Date.now() + 60000), windowStart: new Date(), units: 1 }); await expect(claimAdCopyGeneration('a', 1)).rejects.toMatchObject({ statusCode: 429 });
    m.find.mockResolvedValue({ leaseUntil: new Date(0), windowStart: new Date(Math.floor(Date.now() / 3600000) * 3600000), units: 40 }); await expect(claimAdCopyGeneration('a', 1)).rejects.toMatchObject({ statusCode: 429 }); expect(m.upsert).not.toHaveBeenCalled();
});
