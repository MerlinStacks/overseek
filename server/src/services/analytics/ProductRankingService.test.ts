import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ search: vi.fn(), account: vi.fn(), products: vi.fn() }));
vi.mock('../../utils/elastic', () => ({ esClient: { search: mocks.search } }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.account }, wooProduct: { findMany: mocks.products } } }));
import { ProductRankingService, rankingWindows } from './ProductRankingService';
const row = (id: number, revenue: number) => ({ key: String(id), revenue: { value: revenue }, units: { value: 2 }, orders: { doc_count: 1 } });
const response = (rows: unknown[] = [], currency = 'USD') => ({ timed_out: false, _shards: { failed: 0 }, hits: { total: { value: rows.length, relation: 'eq' } }, aggregations: { missing_currency: { doc_count: 0 }, currencies: { buckets: rows.length ? [{ key: currency, doc_count: rows.length }] : [], sum_other_doc_count: 0 }, products: { doc_count: rows.length, product_ids: { value: rows.length }, revenue_values: { value: rows.length }, unit_values: { value: rows.length }, covered_orders: { doc_count: rows.length }, by_product: { buckets: rows, sum_other_doc_count: 0, doc_count_error_upper_bound: 0 } } } });
describe('complete observed-product rankings', () => {
    beforeEach(() => { vi.resetAllMocks(); mocks.account.mockResolvedValue({ revenueTaxInclusive: true }); mocks.products.mockResolvedValue([]); });
    it('uses adjacent equal half-open UTC windows including leap year YTD', () => { const w = rankingWindows('ytd', new Date('2024-03-01T12:00:00Z')); expect(w.start.toISOString()).toBe('2024-01-01T00:00:00.000Z'); expect(w.end.getTime() - w.start.getTime()).toBe(w.previousEnd.getTime() - w.previousStart.getTime()); });
    it('retains disappeared products and leaves zero-base growth/margins unknown', async () => {
        mocks.search.mockResolvedValueOnce(response([row(1, 50)])).mockResolvedValueOnce(response([row(2, 30)]));
        const result = await ProductRankingService.getProductRankings('account');
        expect(result.summary).toMatchObject({ totalProducts: 2, totalRevenue: 50, currency: 'USD' });
        expect(result.topPerformers[0]).toMatchObject({ wooId: 1, trendPercent: null, profitMargin: null });
        expect(result.bottomPerformers[0]).toMatchObject({ wooId: 2, revenue: 0, trendPercent: -100 });
        expect(mocks.search.mock.calls[0][0].query.bool.filter[2].range.date_created).toHaveProperty('lt');
    });
    it('propagates search failures instead of successful zeroes', async () => { mocks.search.mockRejectedValue(new Error('offline')); await expect(ProductRankingService.getProductRankings('account')).rejects.toThrow('offline'); });
    it('refuses cross-window mixed currency', async () => { mocks.search.mockResolvedValueOnce(response([row(1, 50)])).mockResolvedValueOnce(response([row(1, 30)], 'EUR')); await expect(ProductRankingService.getProductRankings('account')).rejects.toThrow('currencies differ'); });
    it('refuses truncated or approximate aggregates', async () => { const value = response([row(1, 50)]); value.aggregations.products.by_product.sum_other_doc_count = 1; mocks.search.mockResolvedValue(value); await expect(ProductRankingService.getProductRankings('account')).rejects.toThrow('coverage'); });
    it('empty indexed windows do not establish a currency or monetary zero', async () => { mocks.search.mockResolvedValue(response()); expect((await ProductRankingService.getProductRankings('account')).summary).toMatchObject({ totalRevenue: null, currency: null }); });
    it('does not sum missing indexed monetary fields as known zero', async () => { const value = response([row(1, 50)]); value.aggregations.products.revenue_values.value = 0; mocks.search.mockResolvedValue(value); await expect(ProductRankingService.getProductRankings('account')).rejects.toThrow('coverage'); });
    it('rejects unsupported sort/period/limits before querying', async () => { await expect(ProductRankingService.getProductRankings('account', '30d', 'margin')).rejects.toThrow(); await expect(ProductRankingService.getProductRankings('account', 'invalid' as '30d')).rejects.toThrow(); expect(mocks.search).not.toHaveBeenCalled(); });
});
