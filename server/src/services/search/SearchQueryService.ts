import { esClient } from '../../utils/elastic';
import { Logger } from '../../utils/logger';

export class SearchQueryService {

    /**
     * Perform a multi-index search
     */
    static async globalSearch(accountId: string, query: string) {
        if (!query || query.length < 2) return { products: [], customers: [], orders: [] };

        try {
            const commonMust = [{ term: { accountId } }];

            const [products, customers, orders] = await Promise.all([
                // 1. Products Search - Prioritize exact phrase matches
                esClient.search({
                    index: 'products',
                    size: 5,
                    track_scores: true,
                    query: {
                        bool: {
                            must: commonMust,
                            should: [
                                // Highest priority: exact phrase match on name
                                { match_phrase: { name: { query, boost: 10 } } },
                                // High priority: all words present in name
                                { match: { name: { query, operator: 'and', boost: 5 } } },
                                // Medium priority: any words present in name
                                { match: { name: { query, boost: 2 } } },
                                // Lower priority: SKU and category matches
                                { term: { sku: { value: query.toUpperCase(), boost: 3 } } },
                                { match: { sku: { query, boost: 1 } } },
                                // Category name matching
                                {
                                    nested: {
                                        path: 'categories',
                                        query: { term: { 'categories.name': query } }
                                    }
                                }
                            ],
                            minimum_should_match: 1
                        }
                    },
                    sort: [{ _score: { order: 'desc' } }]
                }),

                // 2. Customers Search
                esClient.search({
                    index: 'customers',
                    size: 5,
                    query: {
                        bool: {
                            must: commonMust,
                            should: [
                                { match: { firstName: query } },
                                { match: { lastName: query } },
                                { term: { email: query } }
                            ],
                            minimum_should_match: 1
                        }
                    }
                }),

                // 3. Orders Search
                esClient.search({
                    index: 'orders',
                    size: 5,
                    query: {
                        bool: {
                            must: commonMust,
                            should: [
                                { term: { id: query } },
                                { term: { number: query } }
                            ],
                            minimum_should_match: 1
                        }
                    }
                })
            ]);

            return {
                products: (products.hits.hits || []).map(h => h._source),
                customers: (customers.hits.hits || []).map(h => h._source),
                orders: (orders.hits.hits || []).map(h => h._source)
            };

        } catch (error) {
            Logger.error('Global Search Error', { error });
            return { products: [], customers: [], orders: [] };
        }
    }

    static async searchOrders(accountId: string, query?: string, page: number = 1, limit: number = 50, tags?: string[], status?: string) {
        try {
            const must: any[] = [{ term: { accountId } }];

            // Status filter
            if (status && status.toLowerCase() !== 'all') {
                must.push({ term: { status: status.toLowerCase() } });
            }

            // Tag filter
            if (tags && tags.length > 0) {
                must.push({ terms: { tags: tags } });
            }

            if (query && query.trim().length > 0) {
                must.push({
                    bool: {
                        should: [
                            { term: { id: query } },
                            { match: { 'billing.first_name': { query, fuzziness: 'AUTO' } } },
                            { match: { 'billing.last_name': { query, fuzziness: 'AUTO' } } },
                            { match: { 'billing.email': query } },
                            // Search line item names
                            {
                                nested: {
                                    path: 'line_items',
                                    query: {
                                        match: { 'line_items.name': query }
                                    }
                                }
                            },
                            // Search order-level metadata
                            {
                                nested: {
                                    path: 'meta_data',
                                    query: {
                                        match: { 'meta_data.value': query }
                                    }
                                }
                            },
                            // Search line-item metadata (doubly nested)
                            {
                                nested: {
                                    path: 'line_items',
                                    query: {
                                        nested: {
                                            path: 'line_items.meta_data',
                                            query: {
                                                match: { 'line_items.meta_data.value': query }
                                            }
                                        }
                                    }
                                }
                            }
                        ],
                        minimum_should_match: 1
                    }
                });
            }

            const from = (page - 1) * limit;

            const result = await esClient.search({
                index: 'orders',
                query: { bool: { must } },
                sort: [{ date_created: 'desc' } as any],
                from,
                size: limit,
                track_total_hits: true
            });

            const hits = result.hits.hits || [];
            const total = (result.hits.total as any)?.value || 0;

            return {
                orders: hits.map(h => h._source),
                total,
                page,
                totalPages: Math.ceil(total / limit)
            };

        } catch (error) {
            Logger.error('Order Search Error', { error });
            return [];
        }
    }

    /**
     * Get order counts grouped by status using ES aggregation.
     * Returns a map of status -> count, plus total.
     */
    static async getOrderStatusCounts(accountId: string): Promise<{ total: number; counts: Record<string, number> }> {
        try {
            const result = await esClient.search({
                index: 'orders',
                size: 0,
                query: { term: { accountId } },
                track_total_hits: true,
                aggs: {
                    status_counts: {
                        terms: { field: 'status', size: 20 }
                    }
                }
            });

            const total = (result.hits.total as any)?.value || 0;
            const buckets = (result.aggregations as any)?.status_counts?.buckets || [];
            const counts: Record<string, number> = {};
            for (const bucket of buckets) {
                counts[bucket.key] = bucket.doc_count;
            }

            return { total, counts };
        } catch (error) {
            Logger.error('Get Order Status Counts Error', { error });
            return { total: 0, counts: {} };
        }
    }

    /**
     * Get all unique tags for orders in an account using ES aggregation
     */
    static async getOrderTags(accountId: string): Promise<string[]> {
        try {
            const result = await esClient.search({
                index: 'orders',
                size: 0,
                query: { term: { accountId } },
                aggs: {
                    unique_tags: {
                        terms: { field: 'tags', size: 500 }
                    }
                }
            });

            const buckets = (result.aggregations as any)?.unique_tags?.buckets || [];
            return buckets.map((b: any) => b.key);
        } catch (error) {
            Logger.error('Get Order Tags Error', { error });
            return [];
        }
    }
}
