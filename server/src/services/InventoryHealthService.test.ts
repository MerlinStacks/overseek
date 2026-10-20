import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ settings: vi.fn(), orders: vi.fn(), products: vi.fn(), variants: vi.fn(), send: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { inventorySettings: { findUnique: db.settings }, wooOrder: { findMany: db.orders }, wooProduct: { findMany: db.products }, productVariation: { findMany: db.variants } } }));
vi.mock('./EmailService', () => ({ EmailService: class { sendEmail = db.send; } }));
vi.mock('../utils/getDefaultEmailAccount', () => ({ getDefaultEmailAccount: async () => ({ id: 'email' }) }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn() } }));
import { checkInventoryHealth, sendLowStockAlerts } from './InventoryHealthService';
const product = { id: 'p', wooId: 10, name: '<img src=x onerror=bad()>', mainImage: null, manageStock: false, stockQuantity: 2, rawData: { manage_stock: true } };
beforeEach(() => {
    vi.resetAllMocks(); db.settings.mockResolvedValue(null); db.orders.mockResolvedValue([]); db.products.mockResolvedValue([product]); db.variants.mockResolvedValue([]);
});
describe('inventory health accuracy', () => {
    it('uses each variation sales rather than assigning all parent sales to every variation', async () => {
        db.orders.mockResolvedValue([{ rawData: { line_items: [{ product_id: 10, variation_id: 11, quantity: 60 }, { product_id: 10, variation_id: 12, quantity: 1 }] } }]);
        db.variants.mockResolvedValue([11, 12, 13].map(wooId => ({ wooId, stockQuantity: 10, product, sku: `${wooId}` })));
        const result = await checkInventoryHealth('tenant');
        expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ wooId: 11, velocity: '2.00', daysRemaining: 5 });
    });
    it('does not override explicit false stock management with stale raw data', async () => {
        db.orders.mockResolvedValue([{ rawData: { line_items: [{ product_id: 10, quantity: 100 }] } }]);
        expect(await checkInventoryHealth('tenant')).toEqual([]);
    });
    it('ignores malformed quantities and safely handles null order data', async () => {
        db.products.mockResolvedValue([{ ...product, manageStock: true }]);
        db.orders.mockResolvedValue([{ rawData: null }, { rawData: { line_items: [null, { product_id: 10, quantity: Infinity }, { product_id: 10, quantity: true }, { product_id: 10, quantity: -20 }] } }]);
        expect(await checkInventoryHealth('tenant')).toEqual([]);
    });
    it('escapes product names in alert email HTML', async () => {
        db.settings.mockResolvedValue({ isEnabled: true, alertEmails: ['owner@test.com'], lowStockThresholdDays: 14 });
        db.products.mockResolvedValue([{ ...product, manageStock: true }]);
        db.orders.mockResolvedValue([{ rawData: { line_items: [{ product_id: 10, quantity: 100 }] } }]);
        await sendLowStockAlerts('tenant');
        expect(db.send).toHaveBeenCalledOnce(); expect(db.send.mock.calls[0][4]).toContain('&lt;img'); expect(db.send.mock.calls[0][4]).not.toContain('<img');
    });
    it('rejects missing tenant context before querying', async () => {
        await expect(checkInventoryHealth('')).rejects.toThrow('Account ID'); expect(db.settings).not.toHaveBeenCalled();
    });
});
