import { esClient } from '../../utils/elastic';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SalesForecastService } from './SalesForecast';
import { CustomReportService, CustomReportConfig } from './CustomReport';
import { NON_REVENUE_ORDER_STATUSES } from '../../constants/orderStatus';
import type { Prisma } from '@prisma/client';
import { dateKeyInTimezone, normalizeTimezone, startOfDateInTimezone } from '../../utils/timezone';

function addCalendarDays(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function bucketDate(date: Date, interval: 'day' | 'week' | 'month', timezone: string): string {
    const localDate = dateKeyInTimezone(date, timezone);
    if (interval === 'day') return localDate;
    if (interval === 'month') return `${localDate.slice(0, 7)}-01`;

    const weekStart = new Date(`${localDate}T00:00:00.000Z`);
    const day = weekStart.getUTCDay();
    weekStart.setUTCDate(weekStart.getUTCDate() - (day === 0 ? 6 : day - 1));
    return weekStart.toISOString().slice(0, 10);
}

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
            const nonRevenueStatuses = [...new Set(NON_REVENUE_ORDER_STATUSES.map(status => status.toLowerCase()))];
            const dateCreated: Prisma.DateTimeFilter = {};

            if (startDate) {
                dateCreated.gte = new Date(startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`);
            }

            if (endDate) {
                dateCreated.lte = new Date(endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`);
            }

            const where: Prisma.WooOrderWhereInput = {
                accountId,
                status: { notIn: nonRevenueStatuses },
                ...(Object.keys(dateCreated).length > 0 ? { dateCreated } : {})
            };

            if (useInclusive) {
                const [sales, count] = await Promise.all([
                    prisma.wooOrder.aggregate({ where, _sum: { total: true } }),
                    prisma.wooOrder.count({ where })
                ]);

                return {
                    total: Number(sales._sum.total || 0),
                    count
                };
            }

            const orders = await prisma.wooOrder.findMany({
                where,
                select: { total: true, rawData: true }
            });

            const total = orders.reduce((sum, order) => {
                const rawData = order.rawData as { total_tax?: unknown };
                const tax = Number(rawData?.total_tax ?? 0);
                return sum + Number(order.total) - (Number.isFinite(tax) ? tax : 0);
            }, 0);

            return {
                total,
                count: orders.length
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
    static async getSalesOverTime(accountId: string, startDate?: string, endDate?: string, interval: 'day' | 'week' | 'month' = 'day', timezone?: string) {
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        const effectiveTimezone = normalizeTimezone(timezone || account?.timezone);
        const useInclusive = account?.revenueTaxInclusive ?? true;
        const revenueField = useInclusive ? 'total' : 'net_sales';
        const nonRevenueStatuses = [...new Set(NON_REVENUE_ORDER_STATUSES.map(status => status.toLowerCase()))];

        const finalStartDate = startDate && !startDate.includes('T')
            ? startOfDateInTimezone(startDate, effectiveTimezone)
            : startDate ? new Date(startDate) : undefined;
        const finalEndDate = endDate && !endDate.includes('T')
            ? new Date(startOfDateInTimezone(addCalendarDays(endDate, 1), effectiveTimezone).getTime() - 1)
            : endDate ? new Date(endDate) : undefined;

        try {
            // Use the same authoritative order store as the dashboard KPI. Elasticsearch
            // indexing can lag behind live WooCommerce webhooks and made today's chart total
            // disagree with the Total Revenue widget.
            const orderQuery = {
                where: {
                    accountId,
                    status: { notIn: nonRevenueStatuses },
                    ...(finalStartDate || finalEndDate ? {
                        dateCreated: {
                            ...(finalStartDate ? { gte: finalStartDate } : {}),
                            ...(finalEndDate ? { lte: finalEndDate } : {})
                        }
                    } : {})
                },
                orderBy: { dateCreated: 'asc' as const }
            };
            const orders = useInclusive
                ? await prisma.wooOrder.findMany({
                    ...orderQuery,
                    select: { dateCreated: true, total: true }
                })
                : await prisma.wooOrder.findMany({
                    ...orderQuery,
                    select: { dateCreated: true, total: true, rawData: true }
                });

            const buckets = new Map<string, { sales: number; orders: number }>();
            for (const order of orders) {
                const date = bucketDate(order.dateCreated, interval, effectiveTimezone);
                const rawData = ('rawData' in order ? order.rawData : {}) as { total_tax?: unknown };
                const tax = Number(rawData?.total_tax ?? 0);
                const gross = Number(order.total);
                const sales = revenueField === 'total'
                    ? gross
                    : gross - (Number.isFinite(tax) ? tax : 0);
                const bucket = buckets.get(date) || { sales: 0, orders: 0 };
                bucket.sales += sales;
                bucket.orders += 1;
                buckets.set(date, bucket);
            }

            return Array.from(buckets, ([date, bucket]) => ({
                date,
                sales: Math.round(bucket.sales * 100) / 100,
                orders: bucket.orders
            })).sort((a, b) => a.date.localeCompare(b.date));

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
                { term: { accountId } }
            ];
            const nonRevenueStatuses = [...new Set(NON_REVENUE_ORDER_STATUSES.map(status => status.toLowerCase()))];

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
                query: { bool: { must, must_not: [{ terms: { status: nonRevenueStatuses } }] } },
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
