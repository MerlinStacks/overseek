import { esClient } from '../../utils/elastic';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SalesForecastService } from './SalesForecast';
import { CustomReportService, CustomReportConfig } from './CustomReport';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

/**
 * Sales Analytics Service
 * 
 * Core KPI methods for sales analytics.
 * Forecasting and custom reports are delegated to separate modules.
 */
export class SalesAnalytics {

    /**
     * Get Total Sales (KPI)
     */
    static async getTotalSales(accountId: string, startDate?: string, endDate?: string) {
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId } });
            const useInclusive = account?.revenueTaxInclusive ?? true;
            const revenueField = useInclusive ? 'total' : 'net_sales';

            const must: any[] = [
                { term: { accountId } },
                { terms: { 'status': REVENUE_STATUSES } }
            ];

            if (startDate || endDate) {
                let finalEndDate = endDate;
                if (finalEndDate && !finalEndDate.includes('T')) {
                    finalEndDate = `${finalEndDate}T23:59:59.999`;
                }

                must.push({
                    range: {
                        date_created: {
                            gte: startDate,
                            lte: finalEndDate
                        }
                    }
                });
            }

            const response = await esClient.search({
                index: 'orders',
                size: 0,
                query: { bool: { must } },
                aggs: {
                    total_sales: { sum: { field: revenueField } },
                    order_count: { value_count: { field: 'id' } }
                }
            });
            const aggs = response.aggregations as any;
            return {
                total: aggs?.total_sales?.value || 0,
                count: aggs?.order_count?.value || 0
            };
        } catch (error) {
            Logger.error('Analytics Total Sales Error', { error });
            return { total: 0, count: 0 };
        }
    }

    /**
     * Get Recent Orders
     */
    static async getRecentOrders(accountId: string, limit: number = 5) {
        try {
            const response = await esClient.search({
                index: 'orders',
                size: limit,
                sort: [{ date_created: { order: 'desc' } } as any],
                query: { bool: { must: [{ term: { accountId } }] } }
            });
            return response.hits.hits.map(hit => hit._source);
        } catch (error) {
            Logger.error('Analytics Recent Orders Error', { error });
            return [];
        }
    }

    /**
     * Get Sales Over Time (Date Histogram)
     */
    static async getSalesOverTime(accountId: string, startDate?: string, endDate?: string, interval: 'day' | 'week' | 'month' = 'day', timezone: string = 'UTC') {
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        const useInclusive = account?.revenueTaxInclusive ?? true;
        const revenueField = useInclusive ? 'total' : 'net_sales';

        const must: any[] = [
            { term: { accountId } },
            { terms: { 'status': REVENUE_STATUSES } }
        ];

        if (startDate || endDate) {
            let finalEndDate = endDate;
            if (finalEndDate && !finalEndDate.includes('T')) {
                finalEndDate = `${finalEndDate}T23:59:59.999`;
            }

            must.push({
                range: {
                    date_created: {
                        gte: startDate,
                        lte: finalEndDate
                    }
                }
            });
        }

        try {
            const response = await esClient.search({
                index: 'orders',
                size: 0,
                query: { bool: { must } },
                aggs: {
                    sales_over_time: {
                        date_histogram: {
                            field: 'date_created',
                            calendar_interval: interval,
                            format: 'yyyy-MM-dd',
                            time_zone: timezone
                        },
                        aggs: {
                            total_sales: { sum: { field: revenueField } },
                            order_count: { value_count: { field: 'id' } }
                        }
                    }
                }
            });

            const buckets = (response.aggregations as any)?.sales_over_time?.buckets || [];
            return buckets.map((b: any) => ({
                date: b.key_as_string,
                sales: b.total_sales.value,
                orders: b.order_count.value
            }));

        } catch (error) {
            Logger.error('Analytics Sales Error', { error });
            return [];
        }
    }

    /**
     * Get Top Selling Products (Terms Aggregation)
     */
    static async getTopProducts(accountId: string, startDate?: string, endDate?: string, limit: number = 5) {
        try {
            const must: any[] = [
                { term: { accountId } },
                { terms: { 'status': REVENUE_STATUSES } }
            ];

            if (startDate || endDate) {
                let finalEndDate = endDate;
                if (finalEndDate && !finalEndDate.includes('T')) {
                    finalEndDate = `${finalEndDate}T23:59:59.999`;
                }

                must.push({
                    range: {
                        date_created: {
                            gte: startDate,
                            lte: finalEndDate
                        }
                    }
                });
            }

            const response = await esClient.search({
                index: 'orders',
                size: 0,
                query: { bool: { must } },
                aggs: {
                    top_products: {
                        nested: { path: 'line_items' },
                        aggs: {
                            product_names: {
                                terms: {
                                    field: 'line_items.name.keyword',
                                    size: limit
                                },
                                aggs: {
                                    total_quantity: { sum: { field: 'line_items.quantity' } }
                                }
                            }
                        }
                    }
                }
            });

            const buckets = (response.aggregations as any)?.top_products?.product_names?.buckets || [];
            return buckets.map((b: any) => ({
                name: b.key,
                quantity: b.total_quantity.value,
                revenue: 0
            }));

        } catch (error) {
            Logger.error('Analytics Top Products Error', { error });
            return [];
        }
    }

    // ========================================
    // DELEGATED METHODS (for backward compat)
    // ========================================

    /**
     * Get Sales Forecast - delegates to SalesForecastService
     */
    static async getSalesForecast(accountId: string, daysToForecast: number = 30) {
        return SalesForecastService.getSalesForecast(accountId, daysToForecast);
    }

    /**
     * Get Custom Report - delegates to CustomReportService
     */
    static async getCustomReport(accountId: string, config: CustomReportConfig) {
        return CustomReportService.getCustomReport(accountId, config);
    }
}
