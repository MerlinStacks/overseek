import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: vi.fn(), sales: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.account } } }));
vi.mock('./sales', () => ({ SalesAnalytics: { getTotalSales: mocks.sales } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { AnomalyDetection } from './AnomalyDetection';
beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T02:30:15.123Z'));
    mocks.account.mockResolvedValue({ timezone: 'Australia/Sydney' });
    mocks.sales.mockResolvedValue({ total: 100, count: 1 });
});
afterEach(() => { vi.useRealTimers(); });
describe('revenue anomaly detection', () => {
    it('uses account-local calendar dates and matching local times for all seven baseline days', async () => {
        expect((await AnomalyDetection.getRevenueAnomaly('tenant-1')).isAnomaly).toBe(false);
        expect(mocks.sales).toHaveBeenCalledTimes(8);
        expect(mocks.sales).toHaveBeenNthCalledWith(1, 'tenant-1', '2025-12-31T13:00:00.000Z', '2026-01-01T02:30:15.123Z', { throwOnError: true });
        expect(mocks.sales).toHaveBeenNthCalledWith(2, 'tenant-1', '2025-12-30T13:00:00.000Z', '2025-12-31T02:30:15.123Z', { throwOnError: true });
        expect(mocks.sales).toHaveBeenNthCalledWith(8, 'tenant-1', '2025-12-24T13:00:00.000Z', '2025-12-25T02:30:15.123Z', { throwOnError: true });
    });
    it('preserves the same wall-clock time across daylight-saving changes', async () => {
        vi.setSystemTime(new Date('2026-03-09T16:00:00Z')); // Noon New York after DST starts.
        mocks.account.mockResolvedValue({ timezone: 'America/New_York' });
        await AnomalyDetection.getRevenueAnomaly('tenant-1');
        expect(mocks.sales).toHaveBeenNthCalledWith(3, 'tenant-1', '2026-03-07T05:00:00.000Z', '2026-03-07T17:00:00.000Z', { throwOnError: true });
    });
    it('bounds parallel sales requests to two', async () => {
        let active = 0;
        let maximum = 0;
        mocks.sales.mockImplementation(async () => {
            active++; maximum = Math.max(maximum, active);
            await Promise.resolve(); active--;
            return { total: 100 };
        });
        await AnomalyDetection.getRevenueAnomaly('tenant-1');
        expect(maximum).toBe(2);
    });
    it.each([[125, 'above'], [75, 'below'], [0, 'below']])('preserves anomaly thresholds for revenue %s', async (total, direction) => {
        mocks.sales.mockResolvedValueOnce({ total });
        const result = await AnomalyDetection.getRevenueAnomaly('tenant-1');
        expect(result.isAnomaly).toBe(true);
        expect(result.direction).toBe(direction);
    });
    it('keeps genuine zero-history accounts non-anomalous', async () => {
        mocks.sales.mockResolvedValue({ total: 0 });
        mocks.sales.mockResolvedValueOnce({ total: 100 });
        expect(await AnomalyDetection.getRevenueAnomaly('tenant-1')).toEqual(expect.objectContaining({ isAnomaly: false, todayRevenue: 100, baselineRevenue: 0 }));
    });
    it('propagates unavailable sales data rather than calling it normal', async () => {
        mocks.sales.mockRejectedValue(new Error('Database unavailable'));
        await expect(AnomalyDetection.getRevenueAnomaly('tenant-1')).rejects.toThrow('Database unavailable');
    });
    it('rejects non-finite revenue', async () => {
        mocks.sales.mockResolvedValue({ total: Infinity });
        await expect(AnomalyDetection.getRevenueAnomaly('tenant-1')).rejects.toThrow('Invalid revenue');
    });
});
