import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
    product: vi.fn(), products: vi.fn(), bom: vi.fn(), variations: vi.fn(), variation: vi.fn(), localProduct: vi.fn(), localVariation: vi.fn(),
    get: vi.fn(), getVariation: vi.fn(), getVariations: vi.fn(), update: vi.fn(), updateVariation: vi.fn(), log: vi.fn(), stockGuard: vi.fn()
}));
vi.mock('../../utils/prisma', () => ({ prisma: {
    wooProduct: { findFirst: m.product, findMany: m.products, update: m.localProduct },
    productVariation: { findMany: m.variations, findUnique: m.variation, updateMany: m.localVariation }, bOM: { findUnique: m.bom }
} }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../StockValidationService', () => ({ StockValidationService: { logStockChange: m.log } }));
vi.mock('../bom/BOMRepairStockGuard', () => ({ assertBOMRepairStockInputs: m.stockGuard }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ getProduct: m.get, getProductVariation: m.getVariation, getProductVariations: m.getVariations, updateProduct: m.update, updateProductVariation: m.updateVariation }) } }));
import { BOMInventorySyncService } from '../BOMInventorySyncService';

describe('live BOM repair stock transport', () => {
    let targetStock: number; let childStock: number; let target: any; let component: any;
    beforeEach(() => {
        vi.resetAllMocks(); targetStock = 100; childStock = 98;
        target = { id: 10, type: 'simple', manage_stock: true, backorders: 'no' };
        component = { id: 20, type: 'simple', manage_stock: true };
        m.product.mockResolvedValue({ id: 'parent', accountId: 'a', wooId: 10, name: 'Parent', rawData: { type: 'simple' } });
        m.products.mockResolvedValue([{ id: 'child', stockQuantity: 999 }]); m.variations.mockResolvedValue([]); m.variation.mockResolvedValue({ rawData: {} });
        m.bom.mockResolvedValue({ items: [{ id: 'item', childProductId: 'child', childVariationId: null, internalProductId: null, quantity: 1, wasteFactor: 0,
            childProduct: { id: 'child', accountId: 'a', wooId: 20, name: 'Part', status: 'publish', rawData: {} } }] });
        m.get.mockImplementation(async (id: number) => id === 10 ? { ...target, stock_quantity: targetStock } : { ...component, stock_quantity: childStock });
        m.update.mockImplementation(async (_, data) => { targetStock = data.stock_quantity; return { manage_stock: true, stock_quantity: targetStock }; });
        m.getVariation.mockImplementation(async (_, id) => ({ id, manage_stock: true, stock_quantity: targetStock }));
        m.updateVariation.mockImplementation(async (_, __, data) => { targetStock = data.stock_quantity; return { manage_stock: true, stock_quantity: targetStock }; });
    });
    afterEach(() => vi.restoreAllMocks());
    const repair = (variationId = 0) => BOMInventorySyncService.syncProductToWoo('a', 'parent', variationId, { requireLiveStock: true, repairMode: true, beforeWrite: vi.fn() });

    it('uses fresh stock, writes the recalculated quantity and independently verifies it before reporting success', async () => {
        const result = await repair();
        expect(result).toMatchObject({ success: true, previousStock: 100, newStock: 98 });
        expect(m.update).toHaveBeenCalledExactlyOnceWith(10, { stock_quantity: 98, manage_stock: true, stock_status: 'instock' });
        expect(m.get.mock.calls.every(call => call[1]?.bypassCache === true)).toBe(true);
        expect(m.get.mock.calls.filter(call => call[0] === 10)).toHaveLength(2);
        expect(m.localProduct).toHaveBeenCalledWith({ where: { id: 'parent' }, data: { stockQuantity: 98 } });
        expect(m.log).toHaveBeenCalledOnce();
        expect(m.stockGuard).toHaveBeenCalledWith('a', [10, 20]);
    });
    it('checks unchanged products without unnecessary Woo writes', async () => {
        targetStock = 98;
        expect(await repair()).toMatchObject({ success: true, localDbUpdated: true });
        expect(m.update).not.toHaveBeenCalled();
    });
    it.each([false, 'parent'])('refuses to change a target variation’s stock owner (%s)', async manage_stock => {
        m.getVariation.mockResolvedValue({ id: 21, manage_stock, stock_quantity: 100 });
        await expect(repair(21)).rejects.toThrow('BOM_REPAIR_TARGET_INVALID');
        expect(m.updateVariation).not.toHaveBeenCalled(); expect(m.getVariations).not.toHaveBeenCalled();
    });
    it('uses the exact fresh variation endpoint rather than paging all siblings for every target', async () => {
        expect(await repair(21)).toMatchObject({ success: true, newStock: 98 });
        expect(m.getVariation).toHaveBeenCalledWith(10, 21);
        expect(m.getVariations).not.toHaveBeenCalled();
        expect(m.updateVariation).toHaveBeenCalledOnce();
    });
    it('does not guess from cached stock when live component reads fail', async () => {
        m.get.mockImplementation(async id => { if (id === 20) throw new Error('ETIMEDOUT'); return { ...target, stock_quantity: 100 }; });
        await expect(repair()).rejects.toThrow('ETIMEDOUT');
        expect(m.update).not.toHaveBeenCalled();
    });
    it('retains ambiguous writes and fails verification even when the provider returned a nominal success response', async () => {
        m.update.mockResolvedValue({ stock_quantity: 98, manage_stock: false });
        expect(await repair()).toMatchObject({ success: false, writeUncertain: true });
        expect(m.log).not.toHaveBeenCalled();
    });
    it('reports concurrent component changes after an acknowledged write without pretending verification succeeded', async () => {
        m.update.mockImplementation(async (_, data) => { targetStock = data.stock_quantity; childStock = 97; return { stock_quantity: 98, manage_stock: true }; });
        const result = await repair();
        expect(result).toMatchObject({ success: false, writeUncertain: false, error: expect.stringContaining('BOM_REPAIR_VERIFY_FAILED') });
        expect(m.log).not.toHaveBeenCalled();
    });
    it.each([null, NaN, Infinity])('refuses unknown or invalid live component quantity %s', async value => {
        childStock = value as number;
        await expect(repair()).rejects.toThrow();
        expect(m.update).not.toHaveBeenCalled();
    });
    it('preserves current live backorder policy rather than using cached settings', async () => {
        childStock = 0; target.backorders = 'yes';
        expect(await repair()).toMatchObject({ success: true, newStock: 0 });
        expect(m.update).toHaveBeenCalledWith(10, expect.objectContaining({ stock_status: 'onbackorder' }));
    });
    it('repairs an incorrect live stock status even when the quantity already matches', async () => {
        targetStock = 98; target.stock_status = 'outofstock';
        m.update.mockImplementation(async (_, data) => { target.stock_status = data.stock_status; return { stock_quantity: targetStock, manage_stock: true }; });
        expect(await repair()).toMatchObject({ success: true, previousStock: 98, newStock: 98 });
        expect(m.update).toHaveBeenCalledWith(10, expect.objectContaining({ stock_status: 'instock' }));
    });
    it('does not claim verification if a provider override leaves availability status inconsistent', async () => {
        target.stock_status = 'outofstock';
        expect(await repair()).toMatchObject({ success: false, error: expect.stringContaining('BOM_REPAIR_VERIFY_FAILED') });
    });
    it('refreshes stale target metadata from verified live identity instead of trusting cached product type', async () => {
        m.product.mockResolvedValue({ id: 'parent', accountId: 'a', wooId: 10, name: 'Parent', rawData: { type: 'variable', custom_metadata: 'preserved' } });
        expect(await repair()).toMatchObject({ success: true });
        expect(m.localProduct).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rawData: expect.objectContaining({ type: 'simple', custom_metadata: 'preserved', manage_stock: true }) }) }));
    });
    it('cannot accidentally weaken repair to cached reads by omitting the live-stock option', async () => {
        m.update.mockResolvedValue({ stock_quantity: 98, manage_stock: false });
        expect(await BOMInventorySyncService.syncProductToWoo('a', 'parent', 0, { repairMode: true })).toMatchObject({ success: false, writeUncertain: true });
        expect(m.get.mock.calls.every(call => call[1]?.bypassCache === true)).toBe(true);
    });
    it('never overwrites derived stock while its native stock inputs have unsettled operations', async () => {
        m.stockGuard.mockRejectedValue(new Error('BOM_REPAIR_STOCK_UNSETTLED'));
        await expect(repair()).rejects.toThrow('BOM_REPAIR_STOCK_UNSETTLED');
        expect(m.update).not.toHaveBeenCalled();
    });
});
