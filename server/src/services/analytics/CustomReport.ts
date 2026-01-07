/**
 * Custom Report Builder Service
 * 
 * Extracted from SalesAnalytics for modularity.
 * Dynamically builds Elasticsearch queries for custom analytics reports.
 */

import { esClient } from '../../utils/elastic';
import { Logger } from '../../utils/logger';

export interface CustomReportConfig {
    metrics: string[];       // ['sales', 'orders', 'aov', 'quantity']
    dimension: string;       // 'day', 'month', 'product', 'customer', 'category', 'customer_segment'
    startDate: string;
    endDate: string;
}

export interface CustomReportResult {
    dimension: string;
    sales: number;
    orders: number;
    quantity?: number;
    aov: number;
}

export class CustomReportService {

    /**
     * Build and execute a custom analytics report.
     */
    static async getCustomReport(accountId: string, config: CustomReportConfig): Promise<CustomReportResult[]> {
        try {
            Logger.debug('Custom Report config', { config });

            const must: any[] = [{ term: { accountId } }];

            if (config.startDate || config.endDate) {
                must.push({
                    range: {
                        date_created: {
                            gte: config.startDate,
                            lte: config.endDate
                        }
                    }
                });
            }

            const aggs = this.buildAggregations(config);
            this.attachMetrics(aggs, config);

            const response = await esClient.search({
                index: 'orders',
                size: 0,
                body: {
                    query: { bool: { must } },
                    aggs
                }
            });

            return this.processResults(response.aggregations, config);

        } catch (error) {
            Logger.error('Analytics Custom Report Error', { error });
            return [];
        }
    }

    /**
     * Build dimension-specific aggregations.
     */
    private static buildAggregations(config: CustomReportConfig): any {
        const aggs: any = {};

        if (config.dimension === 'day' || config.dimension === 'month') {
            aggs.group_by_dimension = {
                date_histogram: {
                    field: 'date_created',
                    calendar_interval: config.dimension,
                    format: 'yyyy-MM-dd'
                },
                aggs: {}
            };
        } else if (config.dimension === 'product') {
            aggs.group_by_dimension = {
                nested: { path: 'line_items' },
                aggs: {
                    product_names: {
                        terms: { field: 'line_items.name.keyword', size: 50 },
                        aggs: {}
                    }
                }
            };
        } else if (config.dimension === 'category') {
            aggs.group_by_dimension = {
                nested: { path: 'line_items' },
                aggs: {
                    categories: {
                        terms: { field: 'line_items.categories.name.keyword', size: 50 },
                        aggs: {}
                    }
                }
            };
        } else if (config.dimension === 'customer') {
            aggs.group_by_dimension = {
                terms: { field: 'customer.email.keyword', size: 50 },
                aggs: {}
            };
        } else if (config.dimension === 'customer_segment') {
            // Use order status as segment proxy
            aggs.group_by_dimension = {
                terms: { field: 'status.keyword', size: 10 },
                aggs: {}
            };
        }

        return aggs;
    }

    /**
     * Attach metric aggregations to the dimension buckets.
     */
    private static attachMetrics(aggs: any, config: CustomReportConfig): void {
        const isNested = config.dimension === 'product' || config.dimension === 'category';

        let targetAggs: any;
        if (config.dimension === 'product') {
            targetAggs = aggs.group_by_dimension.aggs.product_names.aggs;
        } else if (config.dimension === 'category') {
            targetAggs = aggs.group_by_dimension.aggs.categories.aggs;
        } else {
            targetAggs = aggs.group_by_dimension.aggs;
        }

        if (config.metrics.includes('sales')) {
            targetAggs.sales = isNested
                ? { sum: { field: 'line_items.total' } }
                : { sum: { field: 'total' } };
        }

        if (config.metrics.includes('quantity')) {
            if (isNested) {
                targetAggs.quantity = { sum: { field: 'line_items.quantity' } };
            } else {
                targetAggs.quantity_nested = {
                    nested: { path: 'line_items' },
                    aggs: { quantity: { sum: { field: 'line_items.quantity' } } }
                };
            }
        }

        if (config.metrics.includes('orders')) {
            if (isNested) {
                targetAggs.orders_count = {
                    reverse_nested: {},
                    aggs: { order_count: { value_count: { field: 'id' } } }
                };
            } else {
                targetAggs.orders = { value_count: { field: 'id' } };
            }
        }

        if (config.metrics.includes('aov') && !isNested) {
            targetAggs.sales = { sum: { field: 'total' } };
            targetAggs.orders = { value_count: { field: 'id' } };
        }
    }

    /**
     * Process aggregation results into uniform output format.
     */
    private static processResults(aggregations: any, config: CustomReportConfig): CustomReportResult[] {
        const processBuckets = (buckets: any[]): CustomReportResult[] => {
            return buckets.map((b: any) => {
                const sales = b.sales?.value || 0;
                let orders = b.orders_count?.order_count?.value || b.orders?.value || 0;
                const quantity = b.quantity?.value;

                return {
                    dimension: b.key_as_string || b.key,
                    sales,
                    orders,
                    quantity,
                    aov: orders > 0 ? sales / orders : 0
                };
            });
        };

        if (config.dimension === 'product') {
            const buckets = aggregations?.group_by_dimension?.product_names?.buckets || [];
            return processBuckets(buckets);
        } else if (config.dimension === 'category') {
            const buckets = aggregations?.group_by_dimension?.categories?.buckets || [];
            return processBuckets(buckets);
        } else {
            const buckets = aggregations?.group_by_dimension?.buckets || [];
            Logger.debug('Analytics default buckets', { count: buckets.length });
            return buckets.map((b: any) => ({
                dimension: b.key_as_string || b.key,
                sales: b.sales?.value || 0,
                orders: b.orders?.value || 0,
                quantity: b.quantity_nested?.quantity?.value || 0,
                aov: (b.orders?.value || 0) > 0 ? (b.sales?.value || 0) / b.orders.value : 0
            }));
        }
    }
}
