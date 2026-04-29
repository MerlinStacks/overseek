import { esClient } from '../../../utils/elastic';
import { Logger } from '../../../utils/logger';
import { REVENUE_STATUSES } from '../../../constants/orderStatus';

export async function getHistoricalSales(
    accountId: string,
    simpleProductWooIds: number[],
    variationWooIds: number[],
    days: number
): Promise<Map<number, Array<{ date: string; quantity: number }>>> {
    const salesMap = new Map<number, Array<{ date: string; quantity: number }>>();

    if (simpleProductWooIds.length === 0 && variationWooIds.length === 0) return salesMap;

    const simpleProductIdSet = new Set(simpleProductWooIds);
    const variationIdSet = new Set(variationWooIds);

    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const nestedShouldClauses: any[] = [];
        if (simpleProductWooIds.length > 0) {
            nestedShouldClauses.push({ terms: { 'line_items.productId': simpleProductWooIds.map(String) } });
        }
        if (variationWooIds.length > 0) {
            nestedShouldClauses.push({ terms: { 'line_items.variationId': variationWooIds.map(String) } });
        }

        const response = await esClient.search({
            index: 'orders',
            size: 0,
            query: {
                bool: {
                    must: [
                        { term: { accountId } },
                        { terms: { status: REVENUE_STATUSES } },
                        {
                            range: {
                                date_created: { gte: startDate.toISOString() }
                            }
                        },
                        {
                            nested: {
                                path: 'line_items',
                                query: {
                                    bool: {
                                        should: nestedShouldClauses,
                                        minimum_should_match: 1
                                    }
                                }
                            }
                        }
                    ]
                }
            },
            aggs: {
                by_day: {
                    date_histogram: { field: 'date_created', calendar_interval: 'day' },
                    aggs: {
                        line_items_nested: {
                            nested: { path: 'line_items' },
                            aggs: {
                                by_product: {
                                    terms: { field: 'line_items.productId', size: 10000 },
                                    aggs: { total_qty: { sum: { field: 'line_items.quantity' } } }
                                },
                                by_variation: {
                                    terms: { field: 'line_items.variationId', size: 10000 },
                                    aggs: { total_qty: { sum: { field: 'line_items.quantity' } } }
                                }
                            }
                        }
                    }
                }
            }
        });

        const dayBuckets = (response.aggregations as any)?.by_day?.buckets || [];

        for (const dayBucket of dayBuckets) {
            const date = new Date(dayBucket.key_as_string || dayBucket.key).toISOString().split('T')[0];

            const productBuckets = dayBucket.line_items_nested?.by_product?.buckets || [];
            for (const productBucket of productBuckets) {
                const productId = Number(productBucket.key);
                if (isNaN(productId) || !simpleProductIdSet.has(productId)) continue;
                const quantity = productBucket.total_qty?.value || 0;
                if (quantity <= 0) continue;
                if (!salesMap.has(productId)) salesMap.set(productId, []);
                salesMap.get(productId)!.push({ date, quantity });
            }

            const variationBuckets = dayBucket.line_items_nested?.by_variation?.buckets || [];
            for (const variationBucket of variationBuckets) {
                const variationId = Number(variationBucket.key);
                if (isNaN(variationId) || variationId === 0 || !variationIdSet.has(variationId)) continue;
                const quantity = variationBucket.total_qty?.value || 0;
                if (quantity <= 0) continue;
                if (!salesMap.has(variationId)) salesMap.set(variationId, []);
                salesMap.get(variationId)!.push({ date, quantity });
            }
        }

    } catch (error: any) {
        Logger.warn('[InventoryForecastService] ES query failed, returning empty sales', {
            error: error.message,
            accountId
        });
    }

    return salesMap;
}
