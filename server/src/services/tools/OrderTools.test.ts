import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooOrder: { findMany: mocks.findMany } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { OrderTools } from './OrderTools';
beforeEach(() => { vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); });
describe('recent order tool', () => {
    it('uses real schema fields, tenant filtering and deterministic ordering', async () => {
        mocks.findMany.mockResolvedValue([{ number: '1001', status: 'processing', total: '25.50', currency: 'AUD', dateCreated: new Date('2026-01-01'), rawData: { billing: { first_name: ' Alice ', last_name: 'Smith' } } }]);
        expect(await OrderTools.getRecentOrders('tenant-1', 10, 'processing')).toEqual([{ id: '1001', status: 'processing', total: 'AUD 25.50', date: '2026-01-01', customer: 'Alice Smith' }]);
        const query = mocks.findMany.mock.calls[0][0];
        expect(query.where).toEqual({ accountId: 'tenant-1', status: 'processing' });
        expect(query.orderBy).toEqual([{ dateCreated: 'desc' }, { id: 'asc' }]);
        expect(query.select.rawData).toBe(true);
        expect(query.select).not.toHaveProperty('billing');
    });
    it.each([null, {}, { billing: null }, { billing: { first_name: 42 } }])('handles missing or malformed billing details: %j', async rawData => {
        mocks.findMany.mockResolvedValue([{ number: '1', rawData }]);
        expect(await OrderTools.getRecentOrders('tenant-1')).toEqual([expect.objectContaining({ customer: 'Guest' })]);
    });
    it.each([0, -1, 1.5, NaN, Infinity, '10'])('defaults invalid limits: %s', async limit => {
        await OrderTools.getRecentOrders('tenant-1', limit as number);
        expect(mocks.findMany.mock.calls[0][0].take).toBe(5);
    });
    it('caps valid limits at twenty and blocks missing tenants', async () => {
        await OrderTools.getRecentOrders('tenant-1', 999);
        expect(mocks.findMany.mock.calls[0][0].take).toBe(20);
        mocks.findMany.mockClear();
        expect(await OrderTools.getRecentOrders('')).toBe('Account ID required.');
        expect(mocks.findMany).not.toHaveBeenCalled();
    });
    it('preserves empty and generic failure messages', async () => {
        expect(await OrderTools.getRecentOrders('tenant-1')).toBe('No orders found.');
        mocks.findMany.mockRejectedValue(new Error('Private error'));
        expect(await OrderTools.getRecentOrders('tenant-1')).toBe('Failed to retrieve orders.');
    });
});
