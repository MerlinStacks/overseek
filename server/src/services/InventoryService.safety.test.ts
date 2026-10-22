import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ product: vi.fn(), bom: vi.fn(), variation: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { wooProduct: { findFirst: m.product }, bOM: { findFirst: m.bom }, productVariation: { findFirst: m.variation } } }));
vi.mock('./InventoryHealthService', () => ({ checkInventoryHealth: vi.fn(), sendLowStockAlerts: vi.fn() }));
import { InventoryService } from './InventoryService';
beforeEach(() => { vi.clearAllMocks(); m.bom.mockResolvedValue(null); m.variation.mockResolvedValue({ id: 'v' }); });
it('does not classify a variable product as a simple parent because a variant has a BOM', async () => {
    m.product.mockResolvedValue({ manageStock: false, stockQuantity: null, rawData: { type: 'variable' }, boms: [{ id: 'b', variationId: 10 }], variations: [{ wooId: 10, sku: null, manageStock: true, stockQuantity: 4, rawData: { attributes: {} } }, { wooId: 11, sku: null, manageStock: true, stockQuantity: 5, rawData: {} }] });
    const result = await InventoryService.getProductStock('a', 'p'); expect(result.isVariable).toBe(true); expect(result.variants).toHaveLength(2); expect(result.stockQuantity).toBeNull(); expect(result.variants?.[0].attributes).toBe(''); expect(m.bom.mock.calls[0][0].where).toMatchObject({ productId: 'p', variationId: 10, product: { accountId: 'a' } });
});
it('preserves unknown variant stock and rejects invalid numeric/management shapes', async () => {
    m.product.mockResolvedValue({ manageStock: false, stockQuantity: null, rawData: {}, boms: [], variations: [{ wooId: 10, manageStock: true, stockQuantity: null, rawData: {} }, { wooId: 11, manageStock: true, stockQuantity: 5, rawData: {} }] });
    expect((await InventoryService.getProductStock('a', 'p')).stockQuantity).toBeNull(); expect(await InventoryService.getEffectiveStock({ manageStock: true, stockQuantity: Infinity, rawData: {} })).toBeNull(); expect(await InventoryService.getEffectiveStock({ manageStock: false, stockQuantity: null, rawData: { manage_stock: 'true', stock_quantity: 5 } })).toBeNull();
});
it('combines repeated component demand and rejects foreign or unknown components', async () => {
    const item = { internalProductId: 'i', internalProduct: { accountId: 'a', stockQuantity: 10 }, childProductId: null, childVariationId: null, supplierItemId: null, quantity: 2, wasteFactor: 0 };
    m.bom.mockResolvedValue({ items: [item, item] }); expect(await InventoryService.calculateBOMStock('a', 'p')).toBe(2);
    m.bom.mockResolvedValue({ items: [{ ...item, internalProduct: { accountId: 'foreign', stockQuantity: 10 } }] }); expect(await InventoryService.calculateBOMStock('a', 'p')).toBeNull();
});
it('rejects missing scope before querying and does not pretend unknown composite cost is zero', async () => { await expect(InventoryService.getProductStock('', 'p')).rejects.toThrow(); expect(m.product).not.toHaveBeenCalled(); expect(await InventoryService.calculateCompositeCOGS('a', 'p')).toBeNull(); });
