import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ products: vi.fn(), variations: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { wooProduct: { findMany: db.products }, productVariation: { findMany: db.variations } } }));
import { getOrderCOGS } from './orderCogs';
const line = { product_id: 10, variation_id: 20, quantity: 2, total: '30.00', name: 'Product' };
beforeEach(() => { vi.resetAllMocks(); db.products.mockResolvedValue([{ wooId: 10, cogs: '5', miscCosts: [{ amount: 1 }], sku: 'parent' }]); db.variations.mockResolvedValue([{ wooId: 20, cogs: '0', miscCosts: [], sku: 'variant', product: { wooId: 10 } }]); });
describe('order cost accuracy', () => {
    it('preserves explicit zero variation COGS without inheriting parent costs', async () => {
        const result = await getOrderCOGS('tenant', { line_items: [line] });
        expect(result.items[0]).toMatchObject({ unitCOGS: 0, lineCOGS: 0, sku: 'variant' }); expect(result.grossProfit).toBe(30);
    });
    it('inherits parent COGS only for missing variation costs and includes variation adjustments', async () => {
        db.variations.mockResolvedValue([{ wooId: 20, cogs: null, miscCosts: [{ amount: '2.50' }], sku: '', product: { wooId: 10 } }]);
        const result = await getOrderCOGS('tenant', { line_items: [line], meta_data: [null, { key: '_stripe_fee', value: '1.25' }] });
        expect(result.totalCOGS).toBe(15); expect(result.paymentFees).toBe(1.25); expect(result.grossProfit).toBe(13.75);
    });
    it('does not use a variation belonging to a different parent', async () => {
        db.variations.mockResolvedValue([{ wooId: 20, cogs: '100', sku: 'wrong', miscCosts: [], product: { wooId: 99 } }]);
        expect((await getOrderCOGS('tenant', { line_items: [line] })).totalCOGS).toBe(12);
    });
    it.each([{ line_items: {} }, { line_items: [null] }, { line_items: [{ ...line, total: '30oops' }] }, { line_items: [{ ...line, quantity: Infinity }] }, { line_items: [line], meta_data: [{ key: '_stripe_fee', value: true }] }])('rejects malformed financial input rather than reporting fabricated totals', async raw => {
        await expect(getOrderCOGS('tenant', raw)).rejects.toThrow();
    });
    it('rejects arithmetic overflow and absent tenant context', async () => {
        db.products.mockResolvedValue([{ wooId: 10, cogs: Number.MAX_VALUE }]); db.variations.mockResolvedValue([]);
        await expect(getOrderCOGS('tenant', { line_items: [line] })).rejects.toThrow(RangeError);
        vi.clearAllMocks(); await expect(getOrderCOGS('', {})).rejects.toThrow('Account ID'); expect(db.products).not.toHaveBeenCalled();
    });
    it('keeps signed adjustments finite', async () => {
        db.variations.mockResolvedValue([]);
        const result = await getOrderCOGS('tenant', { line_items: [{ ...line, quantity: -1, total: '-10' }] });
        expect(result.totalRevenue).toBe(-10); expect(result.totalCOGS).toBe(-6);
    });
});
