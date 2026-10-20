import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: vi.fn(), aggregate: vi.fn(), count: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.account }, wooOrder: { aggregate: mocks.aggregate, count: mocks.count } } }));
vi.mock('../../utils/elastic', () => ({ esClient: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('./SalesForecast', () => ({ SalesForecastService: {} }));
vi.mock('./CustomReport', () => ({ CustomReportService: {} }));
import { SalesAnalytics } from './sales';
beforeEach(() => {
    vi.resetAllMocks();
    mocks.account.mockResolvedValue({ revenueTaxInclusive: true });
    mocks.aggregate.mockResolvedValue({ _sum: { total: 0 } });
    mocks.count.mockResolvedValue(0);
});
describe('total sales failure handling', () => {
    it('keeps genuine zero sales valid in strict mode', async () => {
        expect(await SalesAnalytics.getTotalSales('tenant-1', undefined, undefined, { throwOnError: true })).toEqual({ total: 0, count: 0 });
    });
    it('preserves the fallback for existing KPI callers', async () => {
        mocks.aggregate.mockRejectedValue(new Error('Database unavailable'));
        expect(await SalesAnalytics.getTotalSales('tenant-1')).toEqual({ total: 0, count: 0 });
    });
    it('propagates query failures for anomaly detection in strict mode', async () => {
        mocks.aggregate.mockRejectedValue(new Error('Database unavailable'));
        await expect(SalesAnalytics.getTotalSales('tenant-1', undefined, undefined, { throwOnError: true })).rejects.toThrow('Database unavailable');
    });
});
