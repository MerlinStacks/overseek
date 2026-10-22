import { z } from 'zod';
import { esClient } from '../../utils/elastic';
import { prisma } from '../../utils/prisma';
import { REVENUE_STATUSES } from '../../constants/orderStatus';
export interface ProductRanking { id: string | null; wooId: number; name: string; sku: string | null; image: string | null; revenue: number; unitsSold: number; orderCount: number; avgOrderValue: number | null; profitMargin: null; trend: 'up' | 'down' | 'stable' | 'unknown'; trendPercent: number | null }
export interface RankingResult { topPerformers: ProductRanking[]; bottomPerformers: ProductRanking[]; summary: { totalProducts: number; totalRevenue: number | null; totalUnitsSold: number; avgRevenuePerProduct: number | null; currency: string | null }; coverage: { complete: true; basis: string; productLimit: number; current: { start: string; end: string }; previous: { start: string; end: string }; historicalMargin: null } }
export type SortByField = 'revenue' | 'units' | 'orders' | 'margin';
export type PeriodOption = '7d' | '30d' | '90d' | 'ytd';
const unavailable = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const metric = z.number().finite();
const count = z.number().int().nonnegative().safe();
interface Metrics { productId: number; revenue: number; unitsSold: number; orderCount: number }
export function rankingWindows(period: PeriodOption, now = new Date()) {
    z.enum(['7d', '30d', '90d', 'ytd']).parse(period);
    const end = new Date(now), start = period === 'ytd' ? new Date(Date.UTC(end.getUTCFullYear(), 0, 1)) : new Date(end.getTime() - ({ '7d': 7, '30d': 30, '90d': 90 }[period] * 86400000));
    // Equal elapsed duration, adjacent half-open UTC windows. Leap years do not silently alter exposure.
    return { start, end, previousStart: new Date(start.getTime() - (end.getTime() - start.getTime())), previousEnd: start };
}
export class ProductRankingService {
    static async getProductRankings(accountId: string, period: PeriodOption = '30d', sortBy: SortByField = 'revenue', limit = 10): Promise<RankingResult> {
        z.string().trim().min(1).max(200).parse(accountId); z.enum(['revenue', 'units', 'orders']).parse(sortBy); z.number().int().min(1).max(100).parse(limit);
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { revenueTaxInclusive: true } });
        if (!account) throw unavailable('Account unavailable');
        const w = rankingWindows(period);
        const [current, previous] = await Promise.all([this.metrics(accountId, w.start, w.end, account.revenueTaxInclusive), this.metrics(accountId, w.previousStart, w.previousEnd, account.revenueTaxInclusive)]);
        const currencies = [...new Set([current.currency, previous.currency].filter((value): value is string => value !== null))];
        if (currencies.length > 1) throw unavailable('Comparable single-currency ranking required; currencies differ across windows');
        const currency = currencies[0] || null;
        const ids = [...new Set([...current.rows, ...previous.rows].map(row => row.productId))];
        const products = ids.length ? await prisma.wooProduct.findMany({ where: { accountId, wooId: { in: ids } }, select: { id: true, wooId: true, name: true, sku: true, mainImage: true }, take: 10000 }) : [];
        const productMap = new Map(products.map(row => [row.wooId, row])), curr = new Map(current.rows.map(row => [row.productId, row])), prev = new Map(previous.rows.map(row => [row.productId, row]));
        if (ids.length > 10000) throw unavailable('Combined ranking universe exceeds supported coverage');
        const rankings: ProductRanking[] = ids.map(wooId => {
            // Both aggregates are complete; absence here is an observed zero within the stated cohort.
            const row = curr.get(wooId) || { revenue: 0, unitsSold: 0, orderCount: 0 }, before = prev.get(wooId)?.revenue ?? 0, product = productMap.get(wooId);
            const change = before > 0 ? (row.revenue - before) / before * 100 : null;
            if (change !== null && !Number.isFinite(change)) throw unavailable('Invalid trend');
            return { id: product?.id ?? null, wooId, name: product?.name ?? `Product #${wooId} (local details unavailable)`, sku: product?.sku ?? null, image: product?.mainImage ?? null, revenue: row.revenue, unitsSold: row.unitsSold, orderCount: row.orderCount, avgOrderValue: row.orderCount > 0 ? row.revenue / row.orderCount : null, profitMargin: null, trend: change === null ? 'unknown' : change > 5 ? 'up' : change < -5 ? 'down' : 'stable', trendPercent: change };
        });
        const key = sortBy === 'units' ? 'unitsSold' : sortBy === 'orders' ? 'orderCount' : 'revenue';
        const ordered = [...rankings].sort((a, b) => b[key] - a[key] || a.wooId - b.wooId), total = rankings.reduce((sum, row) => sum + row.revenue, 0), units = rankings.reduce((sum, row) => sum + row.unitsSold, 0);
        if (!Number.isFinite(total) || !Number.isSafeInteger(units)) throw unavailable('Invalid ranking summary');
        return { topPerformers: ordered.slice(0, limit), bottomPerformers: [...ordered].sort((a, b) => a[key] - b[key] || a.wooId - b.wooId).slice(0, limit), summary: { totalProducts: rankings.length, totalRevenue: currency ? total : null, totalUnitsSold: units, avgRevenuePerProduct: currency && rankings.length ? total / rankings.length : null, currency }, coverage: { complete: true, basis: 'products observed in either complete local-index window; operational revenue-status cohort, not full catalog or live-provider ledger', productLimit: 10000, current: { start: w.start.toISOString(), end: w.end.toISOString() }, previous: { start: w.previousStart.toISOString(), end: w.previousEnd.toISOString() }, historicalMargin: null } };
    }
    static async getTopProducts(accountId: string, metric: SortByField = 'revenue', period: PeriodOption = '30d', limit = 5) { return (await this.getProductRankings(accountId, period, metric, limit)).topPerformers; }
    static async getBottomProducts(accountId: string, metric: SortByField = 'revenue', period: PeriodOption = '30d', limit = 5) { return (await this.getProductRankings(accountId, period, metric, limit)).bottomPerformers; }
    private static async metrics(accountId: string, start: Date, end: Date, inclusive: boolean): Promise<{ rows: Metrics[]; currency: string | null }> {
        const result = await esClient.search({ index: 'orders', size: 0, track_total_hits: true, query: { bool: { filter: [{ term: { accountId } }, { terms: { status: [...new Set(REVENUE_STATUSES.map(value => value.toLowerCase()))] } }, { range: { date_created: { gte: start.toISOString(), lt: end.toISOString() } } }] } }, aggs: {
            currencies: { terms: { field: 'currency', size: 2 } }, missing_currency: { missing: { field: 'currency' } }, products: { nested: { path: 'line_items' }, aggs: { product_ids: { value_count: { field: 'line_items.productId' } }, revenue_values: { value_count: { field: inclusive ? 'line_items.total' : 'line_items.net_total' } }, unit_values: { value_count: { field: 'line_items.quantity' } }, covered_orders: { reverse_nested: {} }, by_product: { terms: { field: 'line_items.productId', size: 10001, show_term_doc_count_error: true }, aggs: { revenue: { sum: { field: inclusive ? 'line_items.total' : 'line_items.net_total' } }, units: { sum: { field: 'line_items.quantity' } }, orders: { reverse_nested: {} } } } } },
        } });
        const raw = result.aggregations as any, total = result.hits.total;
        if (result.timed_out || result._shards?.failed || typeof total !== 'object' || total.relation !== 'eq' || !raw || raw.missing_currency?.doc_count !== 0 || !Array.isArray(raw.currencies?.buckets) || raw.currencies.sum_other_doc_count !== 0 || raw.currencies.buckets.length > 1) throw unavailable('Complete single-currency metrics unavailable');
        const currency = raw.currencies.buckets[0]?.key ?? null;
        const nested = raw.products;
        if (!Number.isSafeInteger(nested?.doc_count) || nested.doc_count < 0 || nested.product_ids?.value !== nested.doc_count || nested.revenue_values?.value !== nested.doc_count || nested.unit_values?.value !== nested.doc_count || nested.covered_orders?.doc_count !== total.value) throw unavailable('Line-item metric coverage unavailable');
        if (total.value > 0 && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || raw.currencies.buckets[0].doc_count !== total.value)) throw unavailable('Currency coverage unavailable');
        const terms = raw.products?.by_product;
        if (!terms || !Array.isArray(terms.buckets) || terms.buckets.length > 10000 || terms.sum_other_doc_count !== 0 || terms.doc_count_error_upper_bound !== 0) throw unavailable('Ranking product coverage limit exceeded');
        const rows = terms.buckets.map((bucket: any) => ({ productId: z.coerce.number().int().positive().safe().parse(bucket.key), revenue: metric.parse(bucket.revenue?.value), unitsSold: count.parse(bucket.units?.value), orderCount: count.parse(bucket.orders?.doc_count) }));
        if (new Set(rows.map((row: Metrics) => row.productId)).size !== rows.length) throw unavailable('Duplicate product buckets');
        return { rows, currency };
    }
}
