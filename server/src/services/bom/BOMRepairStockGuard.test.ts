import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ operation: vi.fn(), legacy: vi.fn(), account: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: {
    receiptOperation: { findFirst: m.operation }, receiptLegacyWork: { findFirst: m.legacy }, receiptAccount: { findFirst: m.account }
} }));
import { assertBOMRepairStockInputs } from './BOMRepairStockGuard';
beforeEach(() => { vi.resetAllMocks(); m.operation.mockResolvedValue(null); m.legacy.mockResolvedValue(null); m.account.mockResolvedValue(null); });
it('checks only scoped native owners and excludes internal sentinel IDs', async () => {
    await expect(assertBOMRepairStockInputs('a', [10, 20, 20, 0])).resolves.toBeUndefined();
    expect(m.operation).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accountId: 'a', stockOwnerWooId: { in: [10, 20] } }) }));
    expect(m.legacy).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', state: { not: 'drained' } } }));
});
it.each(['operation', 'legacy', 'account'] as const)('refuses repair when %s work cannot be trusted as settled', async kind => {
    m[kind].mockResolvedValue({ id: 'pending' });
    await expect(assertBOMRepairStockInputs('a', [10])).rejects.toThrow('BOM_REPAIR_STOCK_UNSETTLED');
});
it('fails closed if the safety query is unavailable', async () => {
    m.operation.mockRejectedValue(new Error('DB unavailable'));
    await expect(assertBOMRepairStockInputs('a', [10])).rejects.toThrow('DB unavailable');
});
