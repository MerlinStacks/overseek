import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: vi.fn(), search: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.account } } }));
vi.mock('../../utils/elastic', () => ({ esClient: { search: mocks.search } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { CustomerAnalytics } from './customer';
beforeEach(() => {
    vi.resetAllMocks();
    mocks.account.mockResolvedValue({ timezone: 'Australia/Sydney' });
    mocks.search.mockResolvedValue({ aggregations: { growth_over_time: { buckets: [
        { key_as_string: '2026-01-01', doc_count: 0 }, { key_as_string: '2026-02-01', doc_count: 3 }, { key_as_string: '2026-03-01', doc_count: 0 },
    ] } } });
});
describe('customer growth analytics', () => {
    it('uses account timezone, counts documents, and includes zero months across the requested range', async () => {
        expect(await CustomerAnalytics.getCustomerGrowth('tenant-1', '2026-01-01', '2026-03-31')).toEqual([
            { date: '2026-01-01', newCustomers: 0 }, { date: '2026-02-01', newCustomers: 3 }, { date: '2026-03-01', newCustomers: 0 },
        ]);
        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({
            query: { bool: { must: [{ term: { accountId: 'tenant-1' } }, { range: { dateCreated: { gte: '2025-12-31T13:00:00.000Z', lte: '2026-03-31T12:59:59.999Z' } } }] } },
            aggs: { growth_over_time: { date_histogram: { field: 'dateCreated', calendar_interval: 'month', format: 'yyyy-MM-dd', time_zone: 'Australia/Sydney', min_doc_count: 0,
                extended_bounds: { min: Date.parse('2025-12-31T13:00:00.000Z'), max: Date.parse('2026-03-31T12:59:59.999Z') } } } },
        }));
    });
    it('preserves explicit timestamp ranges and normalizes invalid timezones to UTC', async () => {
        mocks.account.mockResolvedValue({ timezone: 'invalid' });
        await CustomerAnalytics.getCustomerGrowth('tenant-1', '2026-01-01T01:00:00Z', '2026-01-02T02:00:00Z');
        const histogram = mocks.search.mock.calls[0][0].aggs.growth_over_time.date_histogram;
        expect(histogram.time_zone).toBe('UTC');
        expect(histogram.extended_bounds).toEqual({ min: Date.parse('2026-01-01T01:00:00.000Z'), max: Date.parse('2026-01-02T02:00:00.000Z') });
    });
    it('omits empty range filters and bounds when dates are not supplied', async () => {
        await CustomerAnalytics.getCustomerGrowth('tenant-1');
        const query = mocks.search.mock.calls[0][0];
        expect(query.query.bool.must).toEqual([{ term: { accountId: 'tenant-1' } }]);
        expect(query.aggs.growth_over_time.date_histogram.extended_bounds).toBeUndefined();
    });
    it('propagates backend failure instead of returning a false empty result', async () => {
        mocks.search.mockRejectedValue(new Error('Search unavailable'));
        await expect(CustomerAnalytics.getCustomerGrowth('tenant-1')).rejects.toThrow('Search unavailable');
    });
    it.each([['2026-02-30', '2026-03-01'], ['invalid', '2026-03-01'], ['2026-03-02', '2026-03-01']])('rejects invalid ranges %s to %s before search', async (start, end) => {
        await expect(CustomerAnalytics.getCustomerGrowth('tenant-1', start, end)).rejects.toThrow();
        expect(mocks.search).not.toHaveBeenCalled();
    });
});
