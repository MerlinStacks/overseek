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
                // 1. Products Search
                esClient.search({
                    index: 'products',
                    size: 5,
                    body: {
                        query: {
                            bool: {
                                must: commonMust,
                                should: [
                                    { match: { name: { query, boost: 2 } } },
                                    { match: { sku: query } },
                                    { match: { description: query } }
                                ],
                                minimum_should_match: 1
                            }
                        }
                    }
                }),

                // 2. Customers Search
                esClient.search({
                    index: 'customers',
                    size: 5,
                    body: {
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
                    }
                }),

                // 3. Orders Search
                esClient.search({
                    index: 'orders',
                    size: 5,
                    body: {
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

    static async searchOrders(accountId: string, query?: string, page: number = 1, limit: number = 50, tags?: string[]) {
        try {
            const must: any[] = [{ term: { accountId } }];

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
                body: {
                    query: { bool: { must } },
                    sort: [{ date_created: 'desc' }],
                    from,
                    size: limit,
                    track_total_hits: true
                }
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
     * Get all unique tags for orders in an account using ES aggregation
     */
    static async getOrderTags(accountId: string): Promise<string[]> {
        try {
            const result = await esClient.search({
                index: 'orders',
                size: 0,
                body: {
                    query: { term: { accountId } },
                    aggs: {
                        unique_tags: {
                            terms: { field: 'tags', size: 500 }
                        }
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
