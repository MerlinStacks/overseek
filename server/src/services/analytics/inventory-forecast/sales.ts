import { esClient } from '../../../utils/elastic';
import { REVENUE_STATUSES } from '../../../constants/orderStatus';

/** Complete UTC-day history; failures/truncation must never look like zero demand. */
export async function getHistoricalSales(accountId: string, simpleProductWooIds: number[], variationWooIds: number[], days: number,
    excludedVariations: Record<number, number[]> = {}): Promise<Map<number, Array<{ date: string; quantity: number }>>> {
    if (typeof accountId !== 'string' || !accountId.trim() || !Number.isInteger(days) || days < 1 || days > 730) throw new Error('Invalid historical sales scope/window');
    const ids = (values: number[]) => { if (!Array.isArray(values) || values.length > 5000 || values.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)) throw new Error('Invalid/bounded sales identifiers required'); return [...new Set(values)]; };
    const products = ids(simpleProductWooIds); const variants = ids(variationWooIds);
    const result = new Map<number, Array<{ date: string; quantity: number }>>();
    if (!products.length && !variants.length) return result;
    // Keep request clause and histogram-bucket counts below common Elasticsearch limits.
    if (products.length > 25 || variants.length > 25) {
        for (let offset = 0; offset < Math.max(products.length, variants.length); offset += 25) {
            const batch = await getHistoricalSales(accountId, products.slice(offset, offset + 25), variants.slice(offset, offset + 25), days, excludedVariations);
            for (const [id, sales] of batch) result.set(id, [...result.get(id) || [], ...sales]);
        }
        return result;
    }
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - days * 86400000);
    const productFilter = { bool: { should: products.map(id => ({ bool: { must: [{ term: { 'line_items.productId': String(id) } }], must_not: excludedVariations[id]?.length ? [{ terms: { 'line_items.variationId': ids(excludedVariations[id]).map(String) } }] : [] } })), minimum_should_match: 1 } };
    const variantFilter = { terms: { 'line_items.variationId': variants.map(String) } };
    const filter = { bool: { should: [...(products.length ? [productFilter] : []), ...(variants.length ? [variantFilter] : [])], minimum_should_match: 1 } };
    const group = (field: string, selected: number[], selection: any) => ({ filter: selection, aggs: { values: {
        terms: { field, include: selected.map(String), size: selected.length }, aggs: { total_qty: { sum: { field: 'line_items.quantity' } } },
    } } });
    const response = await esClient.search({ index: 'orders', size: 0,
        query: { bool: { filter: [{ term: { accountId } }, { terms: { status: REVENUE_STATUSES } }, { range: { date_created: { gte: start.toISOString(), lt: end.toISOString() } } }, { nested: { path: 'line_items', query: filter } }] } },
        aggs: { by_day: { date_histogram: { field: 'date_created', calendar_interval: 'day', time_zone: 'UTC', min_doc_count: 1 }, aggs: {
            line_items_nested: { nested: { path: 'line_items' }, aggs: {
                ...(products.length ? { products: group('line_items.productId', products, productFilter) } : {}),
                ...(variants.length ? { variants: group('line_items.variationId', variants, variantFilter) } : {}),
            } },
        } } } });
    const data = response as any;
    if (data.timed_out || data._shards?.failed > 0 || !Array.isArray(data.aggregations?.by_day?.buckets)) throw new Error('Historical sales coverage unavailable');
    for (const day of data.aggregations.by_day.buckets) {
        const date = new Date(day.key_as_string || day.key);
        if (!Number.isFinite(date.getTime()) || date < start || date >= end) throw new Error('Invalid historical sales date');
        for (const [section, selected] of [['products', products], ['variants', variants]] as const) {
            if (!selected.length) continue;
            const aggregate = day.line_items_nested?.[section]?.values;
            if (!aggregate || !Array.isArray(aggregate.buckets) || aggregate.sum_other_doc_count > 0 || aggregate.doc_count_error_upper_bound > 0) throw new Error('Historical sales buckets incomplete');
            for (const bucket of aggregate.buckets) {
                const id = Number(bucket.key); const quantity = bucket.total_qty?.value;
                if (!selected.includes(id) || typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) throw new Error('Invalid historical sales quantity');
                if (!result.has(id)) result.set(id, []);
                result.get(id)!.push({ date: date.toISOString().slice(0, 10), quantity });
            }
        }
    }
    return result;
}
