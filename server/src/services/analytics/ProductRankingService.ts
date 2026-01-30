/**
 * Product Ranking Service
 * 
 * Provides comprehensive product performance rankings with multiple metrics.
 */

import { esClient } from '../../utils/elastic';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

export interface ProductRanking {
    id: string;
    wooId: number;
    name: string;
    sku: string | null;
    image: string | null;
    revenue: number;
    unitsSold: number;
    orderCount: number;
    avgOrderValue: number;
    profitMargin?: number;
    trend: 'up' | 'down' | 'stable';
    trendPercent: number;
}

export interface RankingResult {
    topPerformers: ProductRanking[];
    bottomPerformers: ProductRanking[];
    summary: {
        totalProducts: number;
        totalRevenue: number;
        totalUnitsSold: number;
        avgRevenuePerProduct: number;
    };
}

export type SortByField = 'revenue' | 'units' | 'orders' | 'margin';
export type PeriodOption = '7d' | '30d' | '90d' | 'ytd';

export class ProductRankingService {

    /**
     * Get product rankings with top and bottom performers
     */
    static async getProductRankings(
        accountId: string,
        period: PeriodOption = '30d',
        sortBy: SortByField = 'revenue',
        limit: number = 10
    ): Promise<RankingResult> {
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId } });
            const useInclusive = account?.revenueTaxInclusive ?? true;

            const { startDate, endDate, prevStartDate, prevEndDate } = this.resolvePeriod(period);

            // Get current period data from Elasticsearch
            const currentData = await this.getProductMetrics(accountId, startDate, endDate, useInclusive);

            // Get previous period data for trend calculation
            const previousData = await this.getProductMetrics(accountId, prevStartDate, prevEndDate, useInclusive);

            // Get product details from database
            const productIds = [...new Set([
                ...currentData.map(p => p.productId),
                ...previousData.map(p => p.productId)
            ])];

            const products = await prisma.wooProduct.findMany({
                where: { accountId, wooId: { in: productIds } },
                select: {
                    id: true,
                    wooId: true,
                    name: true,
                    sku: true,
                    mainImage: true,
                    cogs: true,
                    price: true
                }
            });

            const productMap = new Map(products.map(p => [p.wooId, p]));
            const prevDataMap = new Map(previousData.map(p => [p.productId, p]));

            // Build rankings
            const rankings: ProductRanking[] = currentData.map(data => {
                const product = productMap.get(data.productId);
                const prevData = prevDataMap.get(data.productId);

                // Calculate trend
                const prevRevenue = prevData?.revenue || 0;
                let trend: 'up' | 'down' | 'stable' = 'stable';
                let trendPercent = 0;

                if (prevRevenue > 0) {
                    trendPercent = Math.round(((data.revenue - prevRevenue) / prevRevenue) * 100);
                    if (trendPercent > 5) trend = 'up';
                    else if (trendPercent < -5) trend = 'down';
                } else if (data.revenue > 0) {
                    trend = 'up';
                    trendPercent = 100;
                }

                // Calculate profit margin if COGS available
                let profitMargin: number | undefined;
                if (product?.cogs && data.revenue > 0) {
                    const totalCogs = Number(product.cogs) * data.unitsSold;
                    profitMargin = Math.round(((data.revenue - totalCogs) / data.revenue) * 100);
                }

                return {
                    id: product?.id || data.productId.toString(),
                    wooId: data.productId,
                    name: product?.name || `Product #${data.productId}`,
                    sku: product?.sku || null,
                    image: product?.mainImage || null,
                    revenue: Math.round(data.revenue * 100) / 100,
                    unitsSold: data.unitsSold,
                    orderCount: data.orderCount,
                    avgOrderValue: data.orderCount > 0
                        ? Math.round((data.revenue / data.orderCount) * 100) / 100
                        : 0,
                    profitMargin,
                    trend,
                    trendPercent
                };
            });

            // Sort based on sortBy field
            const sortedRankings = this.sortRankings(rankings, sortBy);

            // Calculate summary
            const summary = {
                totalProducts: rankings.length,
                totalRevenue: Math.round(rankings.reduce((sum, p) => sum + p.revenue, 0) * 100) / 100,
                totalUnitsSold: rankings.reduce((sum, p) => sum + p.unitsSold, 0),
                avgRevenuePerProduct: rankings.length > 0
                    ? Math.round((rankings.reduce((sum, p) => sum + p.revenue, 0) / rankings.length) * 100) / 100
                    : 0
            };

            // Filter out products with zero revenue for bottom performers (they're not really "performers")
            const activeProducts = sortedRankings.filter(p => p.revenue > 0);

            // For bottom performers, take from the end of the list but only if we have enough products
            const bottomStart = Math.max(0, activeProducts.length - limit);
            const bottomPerformers = activeProducts.slice(bottomStart).reverse();

            return {
                topPerformers: sortedRankings.slice(0, limit),
                bottomPerformers,
                summary
            };
        } catch (error) {
            Logger.error('[ProductRankingService] Error getting rankings', { error, accountId });
            throw error;
        }
    }

    /**
     * Get top N products by a specific metric
     */
    static async getTopProducts(
        accountId: string,
        metric: SortByField = 'revenue',
        period: PeriodOption = '30d',
        limit: number = 5
    ): Promise<ProductRanking[]> {
        const result = await this.getProductRankings(accountId, period, metric, limit);
        return result.topPerformers;
    }

    /**
     * Get bottom N products (worst performers)
     */
    static async getBottomProducts(
        accountId: string,
        metric: SortByField = 'revenue',
        period: PeriodOption = '30d',
        limit: number = 5
    ): Promise<ProductRanking[]> {
        const result = await this.getProductRankings(accountId, period, metric, limit);
        return result.bottomPerformers;
    }

    /**
     * Query Elasticsearch for product performance metrics
     */
    private static async getProductMetrics(
        accountId: string,
        startDate: Date,
        endDate: Date,
        useInclusive: boolean = true
    ): Promise<Array<{ productId: number; revenue: number; unitsSold: number; orderCount: number }>> {
        try {
            const revenueField = useInclusive ? 'line_items.total' : 'line_items.net_total';

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
                                    date_created: {
                                        gte: startDate.toISOString(),
                                        lte: endDate.toISOString()
                                    }
                                }
                            }
                        ]
                    }
                },
                aggs: {
                    products: {
                        nested: { path: 'line_items' },
                        aggs: {
                            by_product: {
                                terms: {
                                    field: 'line_items.productId',
                                    size: 1000
                                },
                                aggs: {
                                    total_revenue: { sum: { field: revenueField } },
                                    total_quantity: { sum: { field: 'line_items.quantity' } },
                                    order_count: {
                                        reverse_nested: {},
                                        aggs: {
                                            count: { cardinality: { field: 'id' } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            const buckets = (response.aggregations as any)?.products?.by_product?.buckets || [];

            return buckets.map((bucket: any) => ({
                productId: bucket.key,
                revenue: bucket.total_revenue?.value || 0,
                unitsSold: bucket.total_quantity?.value || 0,
                orderCount: bucket.order_count?.count?.value || 0
            }));
        } catch (error: any) {
            // If ES is unavailable, return empty rather than throwing
            // This allows the API to degrade gracefully
            Logger.warn('[ProductRankingService] ES query failed, returning empty results', {
                error: error.message,
                accountId
            });
            return [];
        }
    }

    /**
     * Sort rankings by specified field
     */
    private static sortRankings(rankings: ProductRanking[], sortBy: SortByField): ProductRanking[] {
        return [...rankings].sort((a, b) => {
            switch (sortBy) {
                case 'revenue':
                    return b.revenue - a.revenue;
                case 'units':
                    return b.unitsSold - a.unitsSold;
                case 'orders':
                    return b.orderCount - a.orderCount;
                case 'margin':
                    return (b.profitMargin || 0) - (a.profitMargin || 0);
                default:
                    return b.revenue - a.revenue;
            }
        });
    }

    /**
     * Resolve period string to date ranges
     */
    private static resolvePeriod(period: PeriodOption): {
        startDate: Date;
        endDate: Date;
        prevStartDate: Date;
        prevEndDate: Date;
    } {
        const endDate = new Date();
        const startDate = new Date();
        const prevEndDate = new Date();
        const prevStartDate = new Date();

        switch (period) {
            case '7d':
                startDate.setDate(startDate.getDate() - 7);
                prevEndDate.setDate(prevEndDate.getDate() - 7);
                prevStartDate.setDate(prevStartDate.getDate() - 14);
                break;
            case '30d':
                startDate.setDate(startDate.getDate() - 30);
                prevEndDate.setDate(prevEndDate.getDate() - 30);
                prevStartDate.setDate(prevStartDate.getDate() - 60);
                break;
            case '90d':
                startDate.setDate(startDate.getDate() - 90);
                prevEndDate.setDate(prevEndDate.getDate() - 90);
                prevStartDate.setDate(prevStartDate.getDate() - 180);
                break;
            case 'ytd':
                startDate.setMonth(0, 1);
                startDate.setHours(0, 0, 0, 0);
                // Previous YTD: same period last year
                prevEndDate.setFullYear(prevEndDate.getFullYear() - 1);
                prevStartDate.setFullYear(prevStartDate.getFullYear() - 1);
                prevStartDate.setMonth(0, 1);
                prevStartDate.setHours(0, 0, 0, 0);
                break;
        }

        return { startDate, endDate, prevStartDate, prevEndDate };
    }
}
