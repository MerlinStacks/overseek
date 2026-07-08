/**
 * Custom Report Builder Service
 * 
 * Dynamically builds Elasticsearch queries for custom analytics reports.
 * Supports sales-based and traffic-based dimensions with rich metrics.
 */

import { esClient } from '../../utils/elastic';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

/** Available dimensions for custom reports */
export type ReportDimension =
    | 'day' | 'month' | 'product' | 'category' | 'customer' | 'customer_segment'
    | 'traffic_source' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'device' | 'country' | 'order_status';

/** Available metrics for custom reports */
export type ReportMetric =
    | 'sales' | 'orders' | 'aov' | 'quantity'
    | 'visitors' | 'sessions' | 'page_views' | 'conversion_rate' | 'new_customers';

export interface CustomReportConfig {
    metrics: string[];
    dimension: string;
    startDate: string;
    endDate: string;
}

export interface CustomReportResult {
    dimension: string;
    sales?: number;
    orders?: number;
    quantity?: number;
    aov?: number;
    visitors?: number;
    sessions?: number;
    page_views?: number;
    conversion_rate?: number;
    new_customers?: number;
    [key: string]: string | number | undefined;
}

/** Traffic-based dimensions that require session data */
const TRAFFIC_DIMENSIONS = ['traffic_source', 'utm_source', 'utm_medium', 'utm_campaign', 'device', 'country'];

/** Traffic-based metrics that require session data */
const TRAFFIC_METRICS = ['visitors', 'sessions', 'page_views', 'conversion_rate'];

export class CustomReportService {

    /**
     * Build and execute a custom analytics report.
     * Routes to appropriate handler based on dimension type.
     */
    static async getCustomReport(accountId: string, config: CustomReportConfig): Promise<CustomReportResult[]> {
        try {
            Logger.debug('Custom Report config', { config });

            // Determine if this is a traffic-based or order-based report
            const isTrafficDimension = TRAFFIC_DIMENSIONS.includes(config.dimension);
            const hasTrafficMetrics = config.metrics.some(m => TRAFFIC_METRICS.includes(m));

            if (isTrafficDimension || hasTrafficMetrics) {
                return await this.getTrafficReport(accountId, config);
            }

            return await this.getOrderReport(accountId, config);

        } catch (error) {
            Logger.error('Analytics Custom Report Error', { error });
            return [];
        }
    }

    /**
     * Order-based report (uses Elasticsearch orders index)
     */
    private static async getOrderReport(accountId: string, config: CustomReportConfig): Promise<CustomReportResult[]> {
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

        const aggs = this.buildOrderAggregations(config);
        this.attachOrderMetrics(aggs, config);

        const response = await esClient.search({
            index: 'orders',
            size: 0,
            query: { bool: { must } },
            aggs
        });

        return this.processOrderResults(response.aggregations, config);
    }

    /**
     * Traffic-based report (uses Prisma for session/event data)
     */
    private static async getTrafficReport(accountId: string, config: CustomReportConfig): Promise<CustomReportResult[]> {
        const startDate = config.startDate ? new Date(config.startDate) : new Date(0);
        const endDate = config.endDate ? new Date(config.endDate) : new Date();

        // Build group-by field based on dimension
        let groupByField: string;
        switch (config.dimension) {
            case 'traffic_source':
                groupByField = 'referrer';
                break;
            case 'utm_source':
                groupByField = 'utmSource';
                break;
            case 'utm_medium':
                groupByField = 'utmMedium';
                break;
            case 'utm_campaign':
                groupByField = 'utmCampaign';
                break;
            case 'device':
                groupByField = 'deviceType';
                break;
            case 'country':
                groupByField = 'country';
                break;
            default:
                groupByField = 'referrer';
        }

        // Get session data grouped by dimension
        const sessionGroups = await prisma.analyticsSession.groupBy({
            by: [groupByField as any],
            where: {
                accountId,
                lastActiveAt: { gte: startDate, lte: endDate }
            },
            _count: { id: true, visitorId: true },
            orderBy: { _count: { id: 'desc' } },
            take: 50
        });

        // Get page view counts if requested
        let pageViewsByDimension: Map<string, number> = new Map();
        if (config.metrics.includes('page_views')) {
            const pageViews = await this.getPageViewsByDimension(accountId, startDate, endDate, groupByField);
            pageViewsByDimension = pageViews;
        }

        // Get order data for conversion metrics if needed
        let ordersByDimension: Map<string, { orders: number; sales: number }> = new Map();
        if (config.metrics.includes('conversion_rate') || config.metrics.includes('orders') || config.metrics.includes('sales')) {
            ordersByDimension = await this.getOrdersByTrafficDimension(accountId, config.startDate, config.endDate, config.dimension);
        }

        // Build results
        return sessionGroups.map(group => {
            const dimensionValue = (group as any)[groupByField] || '(direct)';
            const sessions = group._count.id;
            const visitors = group._count.visitorId;
            const orderData = ordersByDimension.get(dimensionValue) || { orders: 0, sales: 0 };
            const pageViews = pageViewsByDimension.get(dimensionValue) || 0;

            const result: CustomReportResult = {
                dimension: dimensionValue
            };

            if (config.metrics.includes('sessions')) result.sessions = sessions;
            if (config.metrics.includes('visitors')) result.visitors = visitors;
            if (config.metrics.includes('page_views')) result.page_views = pageViews;
            if (config.metrics.includes('orders')) result.orders = orderData.orders;
            if (config.metrics.includes('sales')) result.sales = orderData.sales;
            if (config.metrics.includes('conversion_rate')) {
                result.conversion_rate = sessions > 0 ? (orderData.orders / sessions) * 100 : 0;
            }
            if (config.metrics.includes('aov')) {
                result.aov = orderData.orders > 0 ? orderData.sales / orderData.orders : 0;
            }

            return result;
        });
    }

    /**
     * Get page views grouped by session dimension
     */
    private static async getPageViewsByDimension(
        accountId: string,
        startDate: Date,
        endDate: Date,
        groupByField: string
    ): Promise<Map<string, number>> {
        const result = new Map<string, number>();

        try {
            // Map groupByField to safe SQL identifier — never interpolate user input as identifier
            const DIMENSION_COLUMNS: Record<string, string> = {
                referrer: '"referrer"',
                utmSource: '"utmSource"',
                utmMedium: '"utmMedium"',
                utmCampaign: '"utmCampaign"',
                deviceType: '"deviceType"',
                country: '"country"',
            };
            const columnExpr = DIMENSION_COLUMNS[groupByField];
            if (!columnExpr) {
                Logger.warn('[CustomReport] Unknown groupByField', { groupByField });
                return result;
            }

            const rawResults: any[] = await prisma.$queryRawUnsafe(
                `SELECT s.${columnExpr} as dimension, COUNT(e.id) as views
                FROM "AnalyticsEvent" e
                JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                WHERE s."accountId" = $1
                AND e."createdAt" >= $2
                AND e."createdAt" <= $3
                AND e.type = 'pageview'
                GROUP BY s.${columnExpr}`,
                accountId, startDate, endDate
            );

            for (const row of rawResults) {
                result.set(row.dimension || '(direct)', Number(row.views));
            }
        } catch (error) {
            Logger.error('Error fetching page views by dimension', { error });
        }

        return result;
    }

    /**
     * Get order data grouped by traffic source dimension
     */
    private static async getOrdersByTrafficDimension(
        accountId: string,
        startDate: string,
        endDate: string,
        dimension: string
    ): Promise<Map<string, { orders: number; sales: number }>> {
        const result = new Map<string, { orders: number; sales: number }>();

        try {
            // Traffic attribution lives on tracked sessions/visits, not reliably on synced order documents.
            // Use purchase events to connect revenue back to the same attribution fields used for sessions.
            let dimensionExpr: string;
            switch (dimension) {
                case 'traffic_source':
                    dimensionExpr = `COALESCE(NULLIF(v."referrer", ''), NULLIF(s."referrer", ''), '(direct)')`;
                    break;
                case 'utm_source':
                    dimensionExpr = `COALESCE(NULLIF(v."utmSource", ''), NULLIF(s."utmSource", ''), '(direct)')`;
                    break;
                case 'utm_medium':
                    dimensionExpr = `COALESCE(NULLIF(v."utmMedium", ''), NULLIF(s."utmMedium", ''), '(direct)')`;
                    break;
                case 'utm_campaign':
                    dimensionExpr = `COALESCE(NULLIF(v."utmCampaign", ''), NULLIF(s."utmCampaign", ''), '(direct)')`;
                    break;
                case 'device':
                    dimensionExpr = `COALESCE(NULLIF(v."deviceType", ''), NULLIF(s."deviceType", ''), '(unknown)')`;
                    break;
                case 'country':
                    dimensionExpr = `COALESCE(NULLIF(v."country", ''), NULLIF(s."country", ''), '(unknown)')`;
                    break;
                default:
                    dimensionExpr = `COALESCE(NULLIF(v."referrer", ''), NULLIF(s."referrer", ''), '(direct)')`;
            }

            const rows: Array<{ dimension: string; orders: bigint | number; sales: unknown }> = await prisma.$queryRawUnsafe(
                `WITH attributed_orders AS (
                    SELECT DISTINCT ON (o.id)
                        o.id,
                        ${dimensionExpr} AS dimension,
                        o.total
                    FROM "AnalyticsEvent" e
                    JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                    LEFT JOIN "AnalyticsVisit" v ON e."visitId" = v.id
                    JOIN "WooOrder" o ON o."accountId" = s."accountId" AND o."wooId" = e."orderId"
                    WHERE s."accountId" = $1
                    AND e.type = 'purchase'
                    AND e."orderId" IS NOT NULL
                    AND o."dateCreated" >= $2
                    AND o."dateCreated" <= $3
                    AND o.status = ANY($4::text[])
                    ORDER BY o.id, e."createdAt" DESC
                )
                SELECT dimension, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS sales
                FROM attributed_orders
                GROUP BY dimension
                ORDER BY orders DESC
                LIMIT 50`,
                accountId,
                new Date(startDate),
                new Date(endDate),
                REVENUE_STATUSES
            );

            for (const row of rows) {
                result.set(row.dimension, {
                    orders: Number(row.orders),
                    sales: Number(row.sales)
                });
            }
        } catch (error) {
            Logger.error('Error fetching orders by traffic dimension', { error });
        }

        return result;
    }

    /**
     * Build dimension-specific aggregations for order-based reports.
     */
    private static buildOrderAggregations(config: CustomReportConfig): any {
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
        } else if (config.dimension === 'customer_segment' || config.dimension === 'order_status') {
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
    private static attachOrderMetrics(aggs: any, config: CustomReportConfig): void {
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

        if (config.metrics.includes('new_customers')) {
            // Count distinct customers making first purchase
            targetAggs.unique_customers = { cardinality: { field: 'customer.email.keyword' } };
        }

        if (config.metrics.includes('aov') && !isNested) {
            targetAggs.sales = { sum: { field: 'total' } };
            targetAggs.orders = { value_count: { field: 'id' } };
        }
    }

    /**
     * Process aggregation results into uniform output format.
     */
    private static processOrderResults(aggregations: any, config: CustomReportConfig): CustomReportResult[] {
        const processBuckets = (buckets: any[]): CustomReportResult[] => {
            return buckets.map((b: any) => {
                const sales = b.sales?.value || 0;
                const orders = b.orders_count?.order_count?.value || b.orders?.value || 0;
                const quantity = b.quantity?.value || b.quantity_nested?.quantity?.value || 0;
                const newCustomers = b.unique_customers?.value || 0;

                const result: CustomReportResult = {
                    dimension: b.key_as_string || b.key
                };

                if (config.metrics.includes('sales')) result.sales = sales;
                if (config.metrics.includes('orders')) result.orders = orders;
                if (config.metrics.includes('quantity')) result.quantity = quantity;
                if (config.metrics.includes('aov')) result.aov = orders > 0 ? sales / orders : 0;
                if (config.metrics.includes('new_customers')) result.new_customers = newCustomers;

                return result;
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
            return processBuckets(buckets);
        }
    }
}
