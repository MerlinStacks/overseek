import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ product: vi.fn(), variations: vi.fn(), update: vi.fn(), localUpdate: vi.fn(), bom: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: {
    wooProduct: { findFirst: async () => ({ id: 'finished', wooId: 20, name: 'Finished', accountId: 'a', rawData: { type: 'simple' } }), findMany: async () => [{ id: 'component', stockQuantity: 999 }], update: m.localUpdate },
    productVariation: { findMany: async () => [], updateMany: m.localUpdate }, bOM: { findUnique: m.bom },
} }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ getProduct: m.product, getProductVariations: m.variations, updateProduct: m.update }) } }));
vi.mock('../StockValidationService', () => ({ StockValidationService: { logStockChange: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { BOMInventorySyncService } from '../BOMInventorySyncService';
const item = (variation: number | null = null) => ({ id: `item-${variation}`, isActive: true, quantity: 1, wasteFactor: 0, supplierItemId: null, internalProductId: null,
    childProductId: 'component', childVariationId: variation, childProduct: { id: 'component', accountId: 'a', wooId: 10, name: 'Component' },
    childVariation: variation ? { productId: 'component', wooId: variation, sku: 'v', stockQuantity: 999 } : null,
});
beforeEach(() => {
    vi.clearAllMocks(); m.bom.mockResolvedValue({ items: [item()] });
    m.product.mockImplementation(async id => ({ id, type: 'simple', manage_stock: true, stock_quantity: id === 20 ? 0 : 8 }));
    m.update.mockImplementation(async (_id, data) => data);
});
describe('strict receipt cascade inventory sources', () => {
    it('uses live component stock and does not overwrite optimistic queued receipt mirrors', async () => {
        const beforeWrite = vi.fn().mockResolvedValue(undefined);
        const result = await BOMInventorySyncService.syncProductToWoo('a', 'finished', 0, { requireLiveStock: true, beforeWrite });
        expect(result.success).toBe(true); expect(result.newStock).toBe(8);
        expect(m.update).toHaveBeenCalledWith(20, expect.objectContaining({ stock_quantity: 8 }));
        expect(m.localUpdate).not.toHaveBeenCalled(); expect(beforeWrite).toHaveBeenCalled();
    });
    it('never substitutes queued local stock after a live component fetch failure', async () => {
        m.product.mockImplementation(async id => { if (id === 10) throw new Error('component GET failed'); return { stock_quantity: 0 }; });
        await expect(BOMInventorySyncService.syncProductToWoo('a', 'finished', 0, { requireLiveStock: true })).rejects.toThrow('component GET failed');
        expect(m.update).not.toHaveBeenCalled();
    });
    it('pools inherited sibling requirements against their physical parent once', async () => {
        m.bom.mockResolvedValue({ items: [item(11), item(12)] });
        m.variations.mockResolvedValue([{ id: 11, manage_stock: false, stock_quantity: null }, { id: 12, manage_stock: false, stock_quantity: null }]);
        const result = await BOMInventorySyncService.syncProductToWoo('a', 'finished', 0, { requireLiveStock: true });
        expect(result.newStock).toBe(4); // Eight parent units / two sibling requirements.
        expect(m.update).toHaveBeenCalledWith(20, expect.objectContaining({ stock_quantity: 4 }));
    });
    it('does not acknowledge a derived write that returned different stock', async () => {
        m.update.mockResolvedValue({ stock_quantity: 0, manage_stock: true });
        const result = await BOMInventorySyncService.syncProductToWoo('a', 'finished', 0, { requireLiveStock: true });
        expect(result.success).toBe(false); expect(result.error).toContain('not acknowledged');
    });
});
