import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../../../utils/elastic', () => ({ esClient: { search: m.search } }));
import { getHistoricalSales } from './sales';
beforeEach(() => vi.resetAllMocks());
describe('complete historical demand coverage', () => {
    it('scopes and filters nested aggregations and keeps missing IDs at zero only after a confirmed complete response', async () => {
        const date = new Date(); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() - 1);
        m.search.mockResolvedValue({ aggregations: { by_day: { buckets: [{ key: date.getTime(), line_items_nested: { products: { values: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0, buckets: [{ key: '1', total_qty: { value: 4 } }] } } } }] } } });
        const result = await getHistoricalSales('tenant', [1, 2], [], 30, { 1: [10] }); expect(result.get(1)[0].quantity).toBe(4); expect(result.has(2)).toBe(false);
        const query = m.search.mock.calls[0][0]; expect(query.query.bool.filter[0]).toEqual({ term: { accountId: 'tenant' } }); expect(query.query.bool.filter[2].range.date_created.lt).toBeDefined();
        expect(query.aggs.by_day.aggs.line_items_nested.aggs.products.aggs.values.terms.include).toEqual(['1', '2']); expect(JSON.stringify(query)).toContain('must_not');
    });
    it.each([{ timed_out: true }, { _shards: { failed: 1 } }, { aggregations: {} }])('does not turn incomplete search into a zero-demand map %j', async response => {
        m.search.mockResolvedValue(response); await expect(getHistoricalSales('tenant', [1], [], 30)).rejects.toThrow('coverage');
    });
    it('propagates failed searches and rejects invalid ID/window input', async () => {
        m.search.mockRejectedValue(new Error('Search offline')); await expect(getHistoricalSales('tenant', [1], [], 30)).rejects.toThrow('offline');
        await expect(getHistoricalSales('tenant', [0], [], 30)).rejects.toThrow('identifiers'); await expect(getHistoricalSales('tenant', [1], [], 0)).rejects.toThrow('window');
    });
    it('batches requested IDs to bound aggregation buckets and clauses', async () => {
        m.search.mockResolvedValue({ aggregations: { by_day: { buckets: [] } } }); await getHistoricalSales('tenant', Array.from({ length: 51 }, (_, i) => i + 1), [], 365); expect(m.search).toHaveBeenCalledTimes(3);
    });
});
