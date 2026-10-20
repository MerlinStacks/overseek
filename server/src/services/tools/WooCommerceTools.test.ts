import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    account: vi.fn(), totals: vi.fn(), orders: vi.fn(), orderCount: vi.fn(), customers: vi.fn(), customerCount: vi.fn(),
    productCount: vi.fn(), reviewCount: vi.fn(), reviewGroups: vi.fn(), reviews: vi.fn(),
}));
vi.mock('../../utils/prisma', () => ({ prisma: {
    account: { findUnique: mocks.account }, wooOrder: { findMany: mocks.orders, count: mocks.orderCount },
    wooProduct: { count: mocks.productCount }, wooCustomer: { findMany: mocks.customers, count: mocks.customerCount },
    wooReview: { count: mocks.reviewCount, groupBy: mocks.reviewGroups, findMany: mocks.reviews },
} }));
vi.mock('../analytics/sales', () => ({ SalesAnalytics: { getTotalSales: mocks.totals } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { WooCommerceTools } from './WooCommerceTools';
beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-09T16:00:00Z'));
    mocks.account.mockResolvedValue({ timezone: 'America/New_York', currency: 'USD' });
    mocks.totals.mockResolvedValue({ total: 100, count: 2 });
    for (const mock of [mocks.productCount, mocks.customerCount, mocks.orderCount, mocks.reviewCount]) mock.mockResolvedValue(5);
    for (const mock of [mocks.orders, mocks.customers, mocks.reviewGroups, mocks.reviews]) mock.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });
describe('extended store tools', () => {
    it('uses the main revenue policy for lifetime overview', async () => {
        expect(await WooCommerceTools.getStoreOverview('tenant-1')).toEqual(expect.objectContaining({ lifetime_revenue: '100.00', currency: 'USD', total_products: 5 }));
        expect(mocks.totals).toHaveBeenCalledWith('tenant-1', undefined, undefined, { throwOnError: true });
    });
    it('limits yesterday to yesterday and compares the previous local day', async () => {
        await WooCommerceTools.getRevenueBreakdown('tenant-1', 'yesterday');
        expect(mocks.totals.mock.calls).toEqual([
            ['tenant-1', '2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.999Z', { throwOnError: true }],
            ['tenant-1', '2026-03-07T05:00:00.000Z', '2026-03-08T04:59:59.999Z', { throwOnError: true }],
        ]);
    });
    it('does not label growth from zero as a flat trend', async () => {
        mocks.totals.mockResolvedValueOnce({ total: 100, count: 2 }).mockResolvedValueOnce({ total: 0, count: 0 });
        expect(await WooCommerceTools.getRevenueBreakdown('tenant-1')).toEqual(expect.objectContaining({ trend: 'up', comparison_available: false, change_percent: 'N/A (no previous revenue)' }));
    });
    it('preserves ordinary revenue percentage comparisons', async () => {
        mocks.totals.mockResolvedValueOnce({ total: 125, count: 2 }).mockResolvedValueOnce({ total: 100, count: 1 });
        expect(await WooCommerceTools.getRevenueBreakdown('tenant-1')).toEqual(expect.objectContaining({ change_percent: '+25.0%', comparison_available: true, trend: 'up' }));
    });
    it('discloses product sampling, separates currencies and handles malformed line items', async () => {
        mocks.orders.mockResolvedValue([
            { currency: 'USD', rawData: { line_items: [null, { product_id: 1, name: 'Mug', quantity: 2, total: '20' }, { product_id: 2, quantity: -1 }] } },
            { currency: 'AUD', rawData: { line_items: [{ product_id: 1, name: 'Mug', quantity: 1, total: '15' }] } },
            { currency: 'USD', rawData: { line_items: 'invalid' } },
        ]);
        const result = await WooCommerceTools.getTopProducts('tenant-1');
        expect(result).toEqual([
            expect.objectContaining({ currency: 'USD', revenue: '20.00', units_sold: 2, sampled_orders: 3, sample_limit: 500 }),
            expect.objectContaining({ currency: 'AUD', revenue: '15.00', units_sold: 1, sampled_orders: 3 }),
        ]);
        expect(mocks.orders.mock.calls[0][0].take).toBe(500);
    });
    it('aggregates reviews in the database and bounds recent review reads', async () => {
        mocks.reviewGroups.mockResolvedValue([{ rating: 5, _count: { _all: 1000 } }, { rating: 1, _count: { _all: 1000 } }]);
        mocks.reviews.mockResolvedValue([{ rating: 5, reviewer: 'Alice', productName: 'Mug', content: 'x'.repeat(110), dateCreated: new Date('2026-01-01') }]);
        expect(await WooCommerceTools.getReviewSummary('tenant-1', 500)).toEqual(expect.objectContaining({ total_reviews: 2000, average_rating: '3.0/5', rating_distribution: { 1: 1000, 2: 0, 3: 0, 4: 0, 5: 1000 } }));
        expect(mocks.reviewGroups).toHaveBeenCalledWith({ by: ['rating'], where: { accountId: 'tenant-1' }, _count: { _all: true } });
        expect(mocks.reviews).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ take: 50 }));
    });
    it('preserves the no-review response without a second query', async () => {
        expect(await WooCommerceTools.getReviewSummary('tenant-1')).toEqual({ total_reviews: 0, average_rating: 'No reviews yet', recent_reviews: [] });
        expect(mocks.reviews).not.toHaveBeenCalled();
    });
    it('caps top-customer queries and scopes them to the tenant', async () => {
        await WooCommerceTools.getTopCustomers('tenant-1', 999);
        expect(mocks.customers).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'tenant-1' }, take: 50 }));
    });
    it('rejects unsupported revenue periods and missing tenants without queries', async () => {
        expect(await WooCommerceTools.getRevenueBreakdown('tenant-1', 'unknown')).toBe('Unsupported revenue period.');
        expect(await WooCommerceTools.getStoreOverview('')).toBe('Account ID required.');
        expect(mocks.account).not.toHaveBeenCalled();
    });
    it('preserves generic failure handling rather than returning fabricated totals', async () => {
        mocks.totals.mockRejectedValue(new Error('Private error'));
        expect(await WooCommerceTools.getRevenueBreakdown('tenant-1')).toBe('Failed to get revenue breakdown.');
    });
});
