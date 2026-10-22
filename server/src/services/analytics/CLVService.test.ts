import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ orders: vi.fn(), sessions: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooOrder: { findMany: m.orders }, analyticsSession: { findMany: m.sessions } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { CLVService } from './CLVService';
const order = { id: 'o', dateCreated: new Date('2026-10-01'), total: 20, currency: 'AUD', rawData: { billing: { email: 'customer@store.test' }, customer_id: 1 } };
beforeEach(() => { vi.clearAllMocks(); m.orders.mockResolvedValue([order]); m.sessions.mockResolvedValue([]); });
it('exposes window/currency/coverage and does not invent direct attribution', async () => {
    const result = await new CLVService().getCLVDashboard('a', 1);
    expect(result.observation).toMatchObject({ basis: 'observed-window-spend', currency: 'AUD', ordersTruncated: false, sessionsTruncated: false, excludedOrders: 0 });
    expect(result.observation.start.slice(-13)).toBe('00:00:00.000Z'); expect(result.clvBySource[0].source).toBe('Unknown');
    expect(m.orders.mock.calls[0][0].where.accountId).toBe('a'); expect(m.orders.mock.calls[0][0].take).toBe(50001);
});
it('makes mixed currency unavailable and counts excluded unidentified orders', async () => {
    m.orders.mockResolvedValue([order, { ...order, id: 'o2', currency: 'USD', rawData: {} }]);
    const result = await new CLVService().getCLVDashboard('a', 1); expect(result.observation.currency).toBeNull(); expect(result.observation.excludedOrders).toBe(1);
});
it('detects truncation rather than silently treating capped rows as complete', async () => {
    m.orders.mockResolvedValue(Array.from({ length: 50001 }, (_, i) => ({ ...order, id: String(i) })));
    const result = await new CLVService().getCLVDashboard('a', 1); expect(result.observation.ordersTruncated).toBe(true);
});
it.each([0, -1, 1.5, 61])('rejects invalid month windows %s', async value => { await expect(new CLVService().getCLVDashboard('a', value)).rejects.toThrow(/Invalid/); expect(m.orders).not.toHaveBeenCalled(); });
