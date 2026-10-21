import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ orders: vi.fn(), products: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { wooOrder: { findMany: m.orders }, wooProduct: { findMany: m.products } } }));
import { PicklistService } from './PicklistService';
const product = (id: number, patch = {}) => ({ wooId: id, boms: [], variations: [], rawData: { manage_stock: true }, stockStatus: 'instock', name: `P${id}`, ...patch });
beforeEach(() => { vi.resetAllMocks(); m.orders.mockResolvedValue([{ number: '1', wooId: 1, rawData: { line_items: [{ product_id: 1, quantity: 2 }] } }]); });
describe('complete bounded picklists', () => {
    it('rejects cyclic BOM recursion', async () => {
        m.products.mockResolvedValue([product(1, { boms: [{ variationId: 0, items: [{ childProduct: { wooId: 1 }, quantity: 1 }] }] })]);
        await expect(new PicklistService().generatePicklist('tenant', {})).rejects.toThrow('cyclic');
    });
    it('uses component variation inventory and applies fractional waste', async () => {
        const products = [product(1, { boms: [{ variationId: 0, items: [{ childProduct: { wooId: 2 }, childVariationId: 3, quantity: 2, wasteFactor: 0.1 }] }] }), product(2, { stockStatus: 'outofstock', variations: [{ wooId: 3, manageStock: true, stockStatus: 'instock', sku: 'V3' }] })];
        m.products.mockImplementation(async ({ where }) => products.filter(p => where.wooId.in.includes(p.wooId)));
        const result = await new PicklistService().generatePicklist('tenant', {}); expect(result[0]).toMatchObject({ productId: '3', totalQuantity: 4.4, stockStatus: 'instock' });
    });
    it.each([{ childProduct: null, quantity: 1 }, { childProduct: { wooId: 1 }, quantity: -1 }])('fails instead of silently omitting incomplete components %j', async component => {
        m.products.mockResolvedValue([product(1, { boms: [{ variationId: 0, items: [component] }] })]); await expect(new PicklistService().generatePicklist('tenant', {})).rejects.toThrow('incomplete');
    });
    it('rejects malformed orders and unbounded requests', async () => {
        m.orders.mockResolvedValue([{ rawData: { line_items: {} } }]); await expect(new PicklistService().generatePicklist('tenant', {})).rejects.toThrow('line items');
        await expect(new PicklistService().generatePicklist('tenant', { limit: 10000 })).rejects.toThrow('options');
    });
    it('bounds expansion work even in an acyclic graph', async () => {
        await expect((new PicklistService() as any).processLineItem('tenant', 1, 0, 1, 'order', 1, new Map([[1, product(1)]]), vi.fn(), new Set(), { remaining: 0 })).rejects.toThrow('expansion limit');
    });
});
