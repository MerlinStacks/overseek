import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: vi.fn(), totals: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.account } } }));
vi.mock('../analytics/sales', () => ({ SalesAnalytics: { getTotalSales: mocks.totals } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { SalesTools } from './SalesTools';
import { revenuePeriods } from './revenuePeriods';
beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-09T16:00:00Z'));
    mocks.account.mockResolvedValue({ timezone: 'America/New_York', currency: 'USD' });
    mocks.totals.mockResolvedValue({ total: 100, count: 2 });
});
afterEach(() => { vi.useRealTimers(); });
describe('sales analytics tool', () => {
    it('uses the shared revenue/tax policy and an exclusive store-local yesterday boundary across DST', async () => {
        expect(await SalesTools.getSalesAnalytics('tenant-1', 'yesterday')).toEqual({ period: 'yesterday', total_sales: 100, order_count: 2, start_date: '2026-03-08', currency: 'USD' });
        expect(mocks.totals).toHaveBeenCalledExactlyOnceWith('tenant-1', '2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.999Z', { throwOnError: true });
    });
    it('rejects unknown periods and missing accounts before any revenue query', async () => {
        expect(await SalesTools.getSalesAnalytics('tenant-1', 'unknown')).toBe('Unsupported sales period.');
        expect(await SalesTools.getSalesAnalytics('', 'today')).toBe('Account ID required.');
        expect(mocks.account).not.toHaveBeenCalled();
        expect(mocks.totals).not.toHaveBeenCalled();
    });
    it('does not disguise backend errors as zero revenue', async () => {
        mocks.totals.mockRejectedValue(new Error('Query failed'));
        expect(await SalesTools.getSalesAnalytics('tenant-1', 'today')).toBe('Failed to calculate analytics.');
    });
    it('compares this month with the corresponding prior-month date, clamped on the 31st', () => {
        const range = revenuePeriods('this_month', 'UTC', new Date('2026-03-31T12:00:00Z'));
        expect(range.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
        expect(range.prevStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
        expect(range.prevEnd.toISOString()).toBe('2026-02-28T12:00:00.000Z');
    });
    it.each(['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'])('builds ordered, non-overlapping comparison windows for %s', period => {
        const range = revenuePeriods(period, 'Australia/Sydney');
        expect(range.start < range.end).toBe(true);
        expect(range.prevStart < range.prevEnd).toBe(true);
        expect(range.prevEnd <= range.start).toBe(true);
    });
    it('compares today with the same clock time yesterday rather than a complete day', () => {
        const range = revenuePeriods('today', 'America/New_York');
        expect(range.prevEnd.toISOString()).toBe('2026-03-08T16:00:00.000Z');
    });
});
