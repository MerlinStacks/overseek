import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooProduct: mocks } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { InventoryTools } from './InventoryTools';
beforeEach(() => { vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); mocks.count.mockResolvedValue(20); });
describe('inventory summary tool', () => {
    it('describes out-of-stock filtering without claiming all inventory is well stocked', async () => {
        expect(await InventoryTools.getInventorySummary('tenant-1')).toEqual({ total_products: 20, low_stock_items: 'None (no products marked out of stock)', stock_filter: 'outofstock' });
    });
    it.each([0, -1, 1.5, NaN, Infinity, '10', null])('defaults invalid limits to five: %s', async limit => {
        await InventoryTools.getInventorySummary('tenant-1', limit as number);
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    });
    it('caps limits and scopes both queries to the selected tenant', async () => {
        const items = [{ name: 'Mug', stockStatus: 'outofstock', sku: 'MUG-1' }];
        mocks.findMany.mockResolvedValue(items);
        expect(await InventoryTools.getInventorySummary('tenant-1', 1000)).toEqual({ total_products: 20, low_stock_items: items, stock_filter: 'outofstock' });
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'tenant-1', stockStatus: 'outofstock' }, take: 50, orderBy: [{ name: 'asc' }, { id: 'asc' }] }));
        expect(mocks.count).toHaveBeenCalledWith({ where: { accountId: 'tenant-1' } });
    });
    it('preserves valid caller limits', async () => {
        await InventoryTools.getInventorySummary('tenant-1', 2);
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    });
    it('does not query without tenant context', async () => {
        expect(await InventoryTools.getInventorySummary('')).toBe('Account ID required.');
        expect(mocks.findMany).not.toHaveBeenCalled();
        expect(mocks.count).not.toHaveBeenCalled();
    });
    it('preserves the generic failure message', async () => {
        mocks.findMany.mockRejectedValue(new Error('Database unavailable'));
        expect(await InventoryTools.getInventorySummary('tenant-1')).toBe('Failed to check inventory.');
    });
});
