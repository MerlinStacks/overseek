import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ boms: vi.fn(), product: vi.fn(), updateProduct: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { bOM: { findMany: m.boms }, wooProduct: { findFirst: m.product } } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../StockValidationService', () => ({ StockValidationService: {} }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ updateProduct: m.updateProduct }) } }));
import { BOMInventorySyncService } from '../BOMInventorySyncService';
import { JobLeaseLostError } from '../queue/JobLease';
beforeEach(() => { vi.clearAllMocks(); m.boms.mockResolvedValue([{ productId: 'p1', variationId: 0 }, { productId: 'p2', variationId: 0 }]); m.product.mockResolvedValue({ rawData: {} }); });
afterEach(() => vi.restoreAllMocks());
it('stops bulk work before the next product when the current execution no longer owns its lock', async () => {
    const sync = vi.spyOn(BOMInventorySyncService, 'syncProductToWoo').mockResolvedValue({ success: true, productId: 'p1', wooId: 1, previousStock: 5, newStock: 5 });
    const assertLease = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new JobLeaseLostError());
    await expect(BOMInventorySyncService.syncAllBOMProducts('a', null, { assertLease })).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(sync).toHaveBeenCalledOnce(); expect(sync.mock.calls[0][3]?.beforeWrite).toBe(assertLease);
});
it('does not swallow lock loss before a stock write and continue through other BOMs', async () => {
    vi.spyOn(BOMInventorySyncService, 'calculateEffectiveStock').mockResolvedValue({ productId: 'p1', wooId: 1, effectiveStock: 5, currentWooStock: 1, needsSync: true, components: [] });
    // Product-boundary guard, post-calculation guard, then the immediate write guard.
    const assertLease = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new JobLeaseLostError());
    await expect(BOMInventorySyncService.syncAllBOMProducts('a', null, { assertLease })).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(m.updateProduct).not.toHaveBeenCalled(); expect(assertLease).toHaveBeenCalledTimes(3);
});
