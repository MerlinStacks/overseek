/**
 * Product Performance Service
 *
 * Deep-dive analytics for individual products, categories, velocity,
 * return rates, and market-bundle analysis.
 */

import { esClient } from '../../utils/elastic';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

type ESBucket = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DailyMetric {
    date: string;
    revenue: number;
    unitsSold: number;
}

export interface ProductDetailResult {
    product: {
        id: string;
        wooId: number;
        name: string;
        sku: string | null;
        image: string | null;
        price: number | null;
        stockStatus: string | null;
    };
    revenueOverTime: DailyMetric[];
    unitsOverTime: DailyMetric[];
    pageViews7d: number;
    pageViews30d: number;
    conversionRate: number;
    cartAddRate: number;
    returnRate: number;
    revenueLostToReturns: number;
    stockVelocity: number;
    totalRevenue: number;
    totalUnitsSold: number;
    totalOrders: number;
    avgOrderValue: number;
    profitMargin: number | null;
}

export interface CategoryPerformanceEntry {
    category: string;
    revenue: number;
    unitsSold: number;
    orderCount: number;
    topProducts: Array<{
        wooId: number;
        name: string;
        revenue: number;
        unitsSold: number;
    }>;
    growthRate: number;
}

export interface CategoryPerformanceResult {
    categories: CategoryPerformanceEntry[];
    summary: {
        totalCategories: number;
        totalRevenue: number;
        totalUnitsSold: number;
    };
}

export interface ProductVelocityEntry {
    wooId: number;
    name: string;
    sku: string | null;
    image: string | null;
    velocity: number;
    previousVelocity: number;
    velocityChange: number;
    trend: 'up' | 'down' | 'stable';
    totalUnits: number;
    totalRevenue: number;
}

export interface ProductVelocityResult {
    products: ProductVelocityEntry[];
    summary: {
        totalProducts: number;
        avgVelocity: number;
        increasingCount: number;
        decreasingCount: number;
    };
}

export interface ProductReturnRateEntry {
    wooId: number;
    name: string;
    sku: string | null;
    totalOrders: number;
    refundedOrders: number;
    returnRate: number;
    totalRevenue: number;
    revenueLostToReturns: number;
}

export interface ProductReturnRateResult {
    products: ProductReturnRateEntry[];
    summary: {
        totalProducts: number;
        overallReturnRate: number;
        totalRevenueLost: number;
    };
}

export interface BundlePair {
    productA: { wooId: number; name: string };
    productB: { wooId: number; name: string };
    coPurchaseCount: number;
    combinedRevenue: number;
}

export interface ProductBundlingResult {
    pairs: BundlePair[];
    summary: {
        totalPairs: number;
        topBundleRevenue: number;
    };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProductPerformanceService {

    // -----------------------------------------------------------------------
    // 1. getProductDetail
    // -----------------------------------------------------------------------

    static async getProductDetail(
        accountId: string,
        productId: number
    ): Promise<ProductDetailResult> {
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId } });
            const useInclusive = account?.revenueTaxInclusive ?? true;

            const product = await prisma.wooProduct.findFirst({
                where: { accountId, wooId: productId },
                select: {
                    id: true,
                    wooId: true,
                    name: true,
                    sku: true,
                    mainImage: true,
                    price: true,
                    stockStatus: true,
                    cogs: true,
                    permalink: true,
                },
            });

            if (!product) {
                throw new Error(`Product #${productId} not found`);
            }

            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            const revenueField = useInclusive ? 'line_items.total' : 'line_items.net_total';

            const [
                timeSeriesData,
                totalsData,
                pageViews,
                cartAddCount,
                returnData,
            ] = await Promise.all([
                this.getProductTimeSeries(accountId, productId, thirtyDaysAgo, now, revenueField),
                this.getProductTotals(accountId, productId, thirtyDaysAgo, now, revenueField),
                product.permalink
                    ? this.getProductPageViews(accountId, product.permalink)
                    : { views7d: 0, views30d: 0 },
                this.getCartAddCount(accountId, product.permalink, thirtyDaysAgo, now),
                this.getProductReturnData(accountId, productId, thirtyDaysAgo, now),
            ]);

            const totalRevenue = totalsData.revenue;
            const totalUnits = totalsData.unitsSold;
            const totalOrders = totalsData.orderCount;
            const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

            let profitMargin: number | null = null;
            if (product.cogs && totalRevenue > 0) {
                const totalCogs = Number(product.cogs) * totalUnits;
                profitMargin = Math.round(((totalRevenue - totalCogs) / totalRevenue) * 100);
            }

            const views30d = pageViews.views30d;
            const conversionRate = views30d > 0 ? Math.round((totalOrders / views30d) * 10000) / 100 : 0;
            const cartAddRate = views30d > 0 ? Math.round((cartAddCount / views30d) * 10000) / 100 : 0;
            const returnRate = totalOrders > 0 ? Math.round((returnData.refundedOrders / totalOrders) * 10000) / 100 : 0;
            const stockVelocity = totalUnits / 30;

            return {
                product: {
                    id: product.id,
                    wooId: product.wooId,
                    name: product.name,
                    sku: product.sku,
                    image: product.mainImage,
                    price: product.price ? Number(product.price) : null,
                    stockStatus: product.stockStatus,
                },
                revenueOverTime: timeSeriesData,
                unitsOverTime: timeSeriesData,
                pageViews7d: pageViews.views7d,
                pageViews30d: views30d,
                conversionRate,
                cartAddRate,
                returnRate,
                revenueLostToReturns: returnData.revenueLost,
                stockVelocity: Math.round(stockVelocity * 100) / 100,
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                totalUnitsSold: totalUnits,
                totalOrders,
                avgOrderValue,
                profitMargin,
            };
        } catch (error) {
            Logger.error('[ProductPerformanceService] Error getting product detail', { error, arguments: { productId } });
            throw error;
        }
    }

    // -----------------------------------------------------------------------
    // 2. getProductCategoryPerformance
    // -----------------------------------------------------------------------

    static async getProductCategoryPerformance(
        accountId: string,
        startDate?: string,
        endDate?: string
    ): Promise<CategoryPerformanceResult> {
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId } });
            const useInclusive = account?.revenueTaxInclusive ?? true;

            const end = endDate ? new Date(endDate) : new Date();
            const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

            const periodMs = end.getTime() - start.getTime();
            const prevEnd = new Date(start.getTime());
            const prevStart = new Date(start.getTime() - periodMs);

            const revenueField = useInclusive ? 'line_items.total' : 'line_items.net_total';

            const [currentCategories, previousCategories] = await Promise.all([
                this.getCategoryMetrics(accountId, start, end, revenueField),
                this.getCategoryMetrics(accountId, prevStart, prevEnd, revenueField),
            ]);

            const prevRevenueMap = new Map(previousCategories.map(c => [c.category, c.revenue]));

            const categories: CategoryPerformanceEntry[] = currentCategories.map(cat => {
                const prevRevenue = prevRevenueMap.get(cat.category) || 0;
                let growthRate = 0;
                if (prevRevenue > 0) {
                    growthRate = Math.round(((cat.revenue - prevRevenue) / prevRevenue) * 100);
                } else if (cat.revenue > 0) {
                    growthRate = 100;
                }

                return {
                    category: cat.category,
                    revenue: Math.round(cat.revenue * 100) / 100,
                    unitsSold: cat.unitsSold,
                    orderCount: cat.orderCount,
                    topProducts: cat.topProducts.slice(0, 5).map(p => ({
                        wooId: p.wooId,
                        name: p.name,
                        revenue: Math.round(p.revenue * 100) / 100,
                        unitsSold: p.unitsSold,
                    })),
                    growthRate,
                };
            });

            categories.sort((a, b) => b.revenue - a.revenue);

            const summary = {
                totalCategories: categories.length,
                totalRevenue: Math.round(categories.reduce((s, c) => s + c.revenue, 0) * 100) / 100,
                totalUnitsSold: categories.reduce((s, c) => s + c.unitsSold, 0),
            };

            return { categories, summary };
        } catch (error) {
            Logger.error('[ProductPerformanceService] Error getting category performance', { error });
            throw error;
        }
    }

    // -----------------------------------------------------------------------
    // 3. getProductVelocity
    // -----------------------------------------------------------------------

    static async getProductVelocity(
        accountId: string,
        days: number = 30
    ): Promise<ProductVelocityResult> {
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId } });
            const useInclusive = account?.revenueTaxInclusive ?? true;

            const now = new Date();
            const currentStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
            const prevEnd = new Date(currentStart.getTime());
            const prevStart = new Date(prevEnd.getTime() - days * 24 * 60 * 60 * 1000);

            const revenueField = useInclusive ? 'line_items.total' : 'line_items.net_total';

            const [currentData, previousData] = await Promise.all([
                this.getProductVelocityMetrics(accountId, currentStart, now, revenueField),
                this.getProductVelocityMetrics(accountId, prevStart, prevEnd, revenueField),
            ]);

            const productIds = [...new Set([
                ...currentData.map(p => p.wooId),
                ...previousData.map(p => p.wooId),
            ])];

            const products = await prisma.wooProduct.findMany({
                where: { accountId, wooId: { in: productIds } },
                select: { wooId: true, name: true, sku: true, mainImage: true },
            });

            const productMap = new Map(products.map(p => [p.wooId, p]));
            const prevMap = new Map(previousData.map(p => [p.wooId, p]));

            const productsList: ProductVelocityEntry[] = currentData.map(data => {
                const product = productMap.get(data.wooId);
                const prevData = prevMap.get(data.wooId);

                const velocity = data.totalUnits / days;
                const previousVelocity = (prevData?.totalUnits || 0) / days;
                const velocityChange = Math.round((velocity - previousVelocity) * 10000) / 10000;

                let trend: 'up' | 'down' | 'stable' = 'stable';
                if (previousVelocity > 0) {
                    const pctChange = ((velocity - previousVelocity) / previousVelocity) * 100;
                    if (pctChange > 5) trend = 'up';
                    else if (pctChange < -5) trend = 'down';
                } else if (velocity > 0) {
                    trend = 'up';
                }

                return {
                    wooId: data.wooId,
                    name: product?.name || `Product #${data.wooId}`,
                    sku: product?.sku || null,
                    image: product?.mainImage || null,
                    velocity: Math.round(velocity * 100) / 100,
                    previousVelocity: Math.round(previousVelocity * 100) / 100,
                    velocityChange: Math.round(velocityChange * 100) / 100,
                    trend,
                    totalUnits: data.totalUnits,
                    totalRevenue: Math.round(data.totalRevenue * 100) / 100,
                };
            });

            productsList.sort((a, b) => b.velocity - a.velocity);

            const totalProducts = productsList.length;
            const avgVelocity = totalProducts > 0
                ? Math.round((productsList.reduce((s, p) => s + p.velocity, 0) / totalProducts) * 100) / 100
                : 0;

            return {
                products: productsList,
                summary: {
                    totalProducts,
                    avgVelocity,
                    increasingCount: productsList.filter(p => p.trend === 'up').length,
                    decreasingCount: productsList.filter(p => p.trend === 'down').length,
                },
            };
        } catch (error) {
            Logger.error('[ProductPerformanceService] Error getting product velocity', { error });
            throw error;
        }
    }

    // -----------------------------------------------------------------------
    // 4. getProductReturnRate
    // -----------------------------------------------------------------------

    static async getProductReturnRate(
        accountId: string,
        startDate?: string,
        endDate?: string
    ): Promise<ProductReturnRateResult> {
        try {
            const end = endDate ? new Date(endDate) : new Date();
            const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);

            const [revenueOrders, refundedOrders] = await Promise.all([
                this.getProductOrderMetrics(accountId, start, end, REVENUE_STATUSES),
                this.getProductOrderMetrics(accountId, start, end, ['refunded', 'Refunded']),
            ]);

            const allWooIds = [...new Set([
                ...revenueOrders.map(p => p.wooId),
                ...refundedOrders.map(p => p.wooId),
            ])];

            const products = await prisma.wooProduct.findMany({
                where: { accountId, wooId: { in: allWooIds } },
                select: { wooId: true, name: true, sku: true },
            });

            const productMap = new Map(products.map(p => [p.wooId, p]));
            const refundedMap = new Map(refundedOrders.map(p => [p.wooId, p]));

            const productsList: ProductReturnRateEntry[] = revenueOrders.map(data => {
                const product = productMap.get(data.wooId);
                const refundedData = refundedMap.get(data.wooId);
                const refundedOrdersCount = refundedData?.orderCount || 0;
                const revenueLost = refundedData?.revenue || 0;

                const returnRate = data.orderCount > 0
                    ? Math.round((refundedOrdersCount / data.orderCount) * 10000) / 100
                    : 0;

                return {
                    wooId: data.wooId,
                    name: product?.name || `Product #${data.wooId}`,
                    sku: product?.sku || null,
                    totalOrders: data.orderCount,
                    refundedOrders: refundedOrdersCount,
                    returnRate,
                    totalRevenue: Math.round(data.revenue * 100) / 100,
                    revenueLostToReturns: Math.round(revenueLost * 100) / 100,
                };
            });

            productsList.sort((a, b) => b.returnRate - a.returnRate);

            const totalOrders = productsList.reduce((s, p) => s + p.totalOrders, 0);
            const totalRefunded = productsList.reduce((s, p) => s + p.refundedOrders, 0);
            const totalRevenueLost = productsList.reduce((s, p) => s + p.revenueLostToReturns, 0);

            return {
                products: productsList,
                summary: {
                    totalProducts: productsList.length,
                    overallReturnRate: totalOrders > 0 ? Math.round((totalRefunded / totalOrders) * 10000) / 100 : 0,
                    totalRevenueLost: Math.round(totalRevenueLost * 100) / 100,
                },
            };
        } catch (error) {
            Logger.error('[ProductPerformanceService] Error getting product return rate', { error });
            throw error;
        }
    }

    // -----------------------------------------------------------------------
    // 5. getProductBundling
    // -----------------------------------------------------------------------

    static async getProductBundling(
        accountId: string,
        startDate?: string,
        endDate?: string
    ): Promise<ProductBundlingResult> {
        try {
            const end = endDate ? new Date(endDate) : new Date();
            const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);

            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    dateCreated: { gte: start, lte: end },
                    status: { in: REVENUE_STATUSES },
                },
                select: {
                    id: true,
                    total: true,
                    rawData: true,
                },
            });

            const pairCounts = new Map<string, number>();
            const pairRevenue = new Map<string, number>();

            for (const order of orders) {
                const raw = order.rawData as Record<string, unknown>;
                const lineItems = raw?.line_items as unknown[] | undefined;

                if (!Array.isArray(lineItems) || lineItems.length < 2) continue;

                const productIds = lineItems
                    .map((item: Record<string, unknown>) => item.product_id as number)
                    .filter((id: number) => id > 0)
                    .sort();

                for (let i = 0; i < productIds.length; i++) {
                    for (let j = i + 1; j < productIds.length; j++) {
                        const pairKey = `${productIds[i]}-${productIds[j]}`;
                        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
                        pairRevenue.set(pairKey, (pairRevenue.get(pairKey) || 0) + Number(order.total));
                    }
                }
            }

            const allWooIds = new Set<number>();
            for (const key of pairCounts.keys()) {
                const [a, b] = key.split('-').map(Number);
                allWooIds.add(a);
                allWooIds.add(b);
            }

            const products = await prisma.wooProduct.findMany({
                where: { accountId, wooId: { in: [...allWooIds] } },
                select: { wooId: true, name: true },
            });

            const productMap = new Map(products.map(p => [p.wooId, p]));

            const pairs: BundlePair[] = [];
            for (const [key, count] of pairCounts.entries()) {
                const [aId, bId] = key.split('-').map(Number);
                const prodA = productMap.get(aId);
                const prodB = productMap.get(bId);
                if (!prodA || !prodB) continue;

                pairs.push({
                    productA: { wooId: aId, name: prodA.name },
                    productB: { wooId: bId, name: prodB.name },
                    coPurchaseCount: count,
                    combinedRevenue: Math.round(pairRevenue.get(key) || 0),
                });
            }

            pairs.sort((a, b) => b.coPurchaseCount - a.coPurchaseCount);

            return {
                pairs: pairs.slice(0, 50),
                summary: {
                    totalPairs: pairs.length,
                    topBundleRevenue: pairs.length > 0 ? pairs[0].combinedRevenue : 0,
                },
            };
        } catch (error) {
            Logger.error('[ProductPerformanceService] Error getting product bundling', { error });
            throw error;
        }
    }

    // =======================================================================
    // Private helpers
    // =======================================================================

    /**
     * Daily revenue/units time-series for a single product (last 30 days).
     */
    private static async getProductTimeSeries(
        accountId: string,
        productId: number,
        startDate: Date,
        endDate: Date,
        revenueField: string
    ): Promise<DailyMetric[]> {
        try {
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
                                        lte: endDate.toISOString(),
                                    },
                                },
                            },
                        ],
                    },
                },
                aggs: {
                    days: {
                        date_histogram: {
                            field: 'date_created',
                            calendar_interval: 'day',
                            format: 'yyyy-MM-dd',
                        },
                        aggs: {
                            line_items_nested: {
                                nested: { path: 'line_items' },
                                aggs: {
                                    target_product: {
                                        filter: {
                                            term: { 'line_items.productId': String(productId) },
                                        },
                                        aggs: {
                                            daily_revenue: { sum: { field: revenueField } },
                                            daily_units: { sum: { field: 'line_items.quantity' } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            const buckets = ((response.aggregations as ESBucket)?.days as ESBucket)?.buckets as ESBucket[] || [];
            return buckets.map((b: ESBucket) => ({
                date: b.key_as_string as string,
                revenue: Math.round((((b.line_items_nested as ESBucket)?.target_product as ESBucket)?.daily_revenue as number || 0) * 100) / 100,
                unitsSold: ((b.line_items_nested as ESBucket)?.target_product as ESBucket)?.daily_units as number || 0,
            }));
        } catch (error: unknown) {
            Logger.warn('[ProductPerformanceService] ES time-series query failed', {
                error: error instanceof Error ? error.message : String(error),
                productId,
            });
            return [];
        }
    }

    /**
     * Total revenue, units, order count for a product over a date range.
     */
    private static async getProductTotals(
        accountId: string,
        productId: number,
        startDate: Date,
        endDate: Date,
        revenueField: string
    ): Promise<{ revenue: number; unitsSold: number; orderCount: number }> {
        try {
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
                                        lte: endDate.toISOString(),
                                    },
                                },
                            },
                        ],
                    },
                },
                aggs: {
                    line_items_nested: {
                        nested: { path: 'line_items' },
                        aggs: {
                            target_product: {
                                filter: {
                                    term: { 'line_items.productId': String(productId) },
                                },
                                aggs: {
                                    total_revenue: { sum: { field: revenueField } },
                                    total_units: { sum: { field: 'line_items.quantity' } },
                                    order_count: {
                                        reverse_nested: {},
                                        aggs: {
                                            count: { cardinality: { field: 'id' } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            const agg = ((response.aggregations as ESBucket)?.line_items_nested as ESBucket)?.target_product as ESBucket;
            return {
                revenue: (agg?.total_revenue as ESBucket)?.value as number || 0,
                unitsSold: (agg?.total_units as ESBucket)?.value as number || 0,
                orderCount: ((agg?.order_count as ESBucket)?.count as ESBucket)?.value as number || 0,
            };
        } catch (error: unknown) {
            Logger.warn('[ProductPerformanceService] ES totals query failed', {
                error: error instanceof Error ? error.message : String(error),
                productId,
            });
            return { revenue: 0, unitsSold: 0, orderCount: 0 };
        }
    }

    /**
     * Page views for a product URL (7d and 30d).
     */
    private static async getProductPageViews(
        accountId: string,
        productUrl: string
    ): Promise<{ views7d: number; views30d: number }> {
        try {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            let pathname: string;
            try {
                pathname = new URL(productUrl).pathname;
            } catch {
                pathname = productUrl;
            }

            const normalizedPath = pathname.replace(/\/+$/, '') || '/';
            const pathWithSlash = normalizedPath + '/';

            const [views7d, views30d] = await Promise.all([
                prisma.$queryRaw<[{ count: bigint }]>`
                    SELECT COUNT(e.id) as count
                    FROM "AnalyticsEvent" e
                    JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                    WHERE s."accountId" = ${accountId}
                    AND e."createdAt" >= ${sevenDaysAgo}
                    AND e.type IN ('pageview', 'product_view')
                    AND regexp_replace(split_part(e.url, '?', 1), '^https?://[^/]+', '') IN (${normalizedPath}, ${pathWithSlash})
                `,
                prisma.$queryRaw<[{ count: bigint }]>`
                    SELECT COUNT(e.id) as count
                    FROM "AnalyticsEvent" e
                    JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                    WHERE s."accountId" = ${accountId}
                    AND e."createdAt" >= ${thirtyDaysAgo}
                    AND e.type IN ('pageview', 'product_view')
                    AND regexp_replace(split_part(e.url, '?', 1), '^https?://[^/]+', '') IN (${normalizedPath}, ${pathWithSlash})
                `,
            ]);

            return {
                views7d: Number(views7d[0]?.count || 0),
                views30d: Number(views30d[0]?.count || 0),
            };
        } catch (error) {
            Logger.error('[ProductPerformanceService] Product page views query failed', { error, productUrl });
            return { views7d: 0, views30d: 0 };
        }
    }

    /**
     * Count of add_to_cart events for a product URL over a date range.
     */
    private static async getCartAddCount(
        accountId: string,
        productUrl: string | null,
        startDate: Date,
        endDate: Date
    ): Promise<number> {
        try {
            if (!productUrl) return 0;

            let pathname: string;
            try {
                pathname = new URL(productUrl).pathname;
            } catch {
                pathname = productUrl;
            }

            const normalizedPath = pathname.replace(/\/+$/, '') || '/';
            const pathWithSlash = normalizedPath + '/';

            const result = await prisma.$queryRaw<[{ count: bigint }]>`
                SELECT COUNT(DISTINCT e.id) as count
                FROM "AnalyticsEvent" e
                JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                WHERE s."accountId" = ${accountId}
                AND e."createdAt" >= ${startDate}
                AND e."createdAt" <= ${endDate}
                AND e.type = 'add_to_cart'
            `;

            return Number(result[0]?.count || 0);
        } catch (error) {
            Logger.error('[ProductPerformanceService] Cart add count query failed', { error });
            return 0;
        }
    }

    /**
     * Return/refund data for a product.
     */
    private static async getProductReturnData(
        accountId: string,
        productId: number,
        startDate: Date,
        endDate: Date
    ): Promise<{ refundedOrders: number; revenueLost: number }> {
        try {
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: ['refunded', 'Refunded'] },
                    dateCreated: { gte: startDate, lte: endDate },
                },
                select: { rawData: true },
            });

            let refundedOrders = 0;
            let revenueLost = 0;

            for (const order of orders) {
                const raw = order.rawData as Record<string, unknown>;
                const lineItems = (raw?.line_items as unknown[]) || [];
                let orderRefundAmount = 0;
                let hasProduct = false;

                for (const item of lineItems as Record<string, unknown>[]) {
                    if ((item as Record<string, unknown>).product_id === productId) {
                        hasProduct = true;
                        orderRefundAmount += parseFloat((item as Record<string, unknown>).total as string || '0');
                    }
                }

                if (hasProduct) {
                    refundedOrders++;
                    revenueLost += orderRefundAmount;
                }
            }

            return { refundedOrders, revenueLost };
        } catch (error) {
            Logger.error('[ProductPerformanceService] Return data query failed', { error, productId });
            return { refundedOrders: 0, revenueLost: 0 };
        }
    }

    /**
     * Category-level metrics from ES.
     */
    private static async getCategoryMetrics(
        accountId: string,
        startDate: Date,
        endDate: Date,
        revenueField: string
    ): Promise<Array<{
        category: string;
        revenue: number;
        unitsSold: number;
        orderCount: number;
        topProducts: Array<{ wooId: number; name: string; revenue: number; unitsSold: number }>;
    }>> {
        try {
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
                                        lte: endDate.toISOString(),
                                    },
                                },
                            },
                        ],
                    },
                },
                aggs: {
                    line_items_nested: {
                        nested: { path: 'line_items' },
                        aggs: {
                            by_category: {
                                terms: {
                                    field: 'line_items.categories.name.keyword',
                                    size: 100,
                                },
                                aggs: {
                                    cat_revenue: { sum: { field: revenueField } },
                                    cat_units: { sum: { field: 'line_items.quantity' } },
                                    by_product: {
                                        terms: {
                                            field: 'line_items.productId',
                                            size: 20,
                                        },
                                        aggs: {
                                            prod_revenue: { sum: { field: revenueField } },
                                            prod_units: { sum: { field: 'line_items.quantity' } },
                                            prod_name: { top_hits: { size: 1, _source: { includes: ['line_items.name.keyword'] } } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            const buckets = (((response.aggregations as ESBucket)?.line_items_nested as ESBucket)?.by_category as ESBucket)?.buckets as ESBucket[] || [];

            const allProductIds = new Set<number>();
            for (const catBucket of buckets) {
                for (const prodBucket of ((catBucket as ESBucket)?.by_product as ESBucket)?.buckets as ESBucket[] || []) {
                    allProductIds.add(prodBucket.key as number);
                }
            }

            const products = await prisma.wooProduct.findMany({
                where: { accountId, wooId: { in: [...allProductIds] } },
                select: { wooId: true, name: true },
            });
            const productMap = new Map(products.map(p => [p.wooId, p]));

            return buckets.map((bucket: ESBucket) => {
                const topProducts = (((bucket as ESBucket)?.by_product as ESBucket)?.buckets as ESBucket[] || []).map((pb: ESBucket) => {
                    const product = productMap.get(pb.key as number);
                    const fallbackName = (((pb.prod_name as ESBucket)?.hits as ESBucket)?.hits as ESBucket[])?.[0]?._source as string;
                    return {
                        wooId: pb.key as number,
                        name: product?.name || (typeof fallbackName === 'string' ? fallbackName : `Product #${pb.key}`),
                        revenue: (pb.prod_revenue as ESBucket)?.value as number || 0,
                        unitsSold: (pb.prod_units as ESBucket)?.value as number || 0,
                    };
                });

                return {
                    category: bucket.key as string,
                    revenue: (bucket.cat_revenue as ESBucket)?.value as number || 0,
                    unitsSold: (bucket.cat_units as ESBucket)?.value as number || 0,
                    orderCount: 0,
                    topProducts,
                };
            });
        } catch (error: unknown) {
            Logger.warn('[ProductPerformanceService] ES category metrics query failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    /**
     * Per-product velocity metrics (units + revenue) over a date range.
     */
    private static async getProductVelocityMetrics(
        accountId: string,
        startDate: Date,
        endDate: Date,
        revenueField: string
    ): Promise<Array<{ wooId: number; totalUnits: number; totalRevenue: number }>> {
        try {
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
                                        lte: endDate.toISOString(),
                                    },
                                },
                            },
                        ],
                    },
                },
                aggs: {
                    line_items_nested: {
                        nested: { path: 'line_items' },
                        aggs: {
                            by_product: {
                                terms: {
                                    field: 'line_items.productId',
                                    size: 10000,
                                },
                                aggs: {
                                    total_units: { sum: { field: 'line_items.quantity' } },
                                    total_revenue: { sum: { field: revenueField } },
                                },
                            },
                        },
                    },
                },
            });

            const buckets = (((response.aggregations as ESBucket)?.line_items_nested as ESBucket)?.by_product as ESBucket)?.buckets as ESBucket[] || [];

            return buckets.map((b: ESBucket) => ({
                wooId: b.key as number,
                totalUnits: (b.total_units as ESBucket)?.value as number || 0,
                totalRevenue: (b.total_revenue as ESBucket)?.value as number || 0,
            }));
        } catch (error: unknown) {
            Logger.warn('[ProductPerformanceService] ES velocity query failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    /**
     * Per-product order metrics (revenue, units, order count) filtered by status.
     */
    private static async getProductOrderMetrics(
        accountId: string,
        startDate: Date,
        endDate: Date,
        statuses: string[]
    ): Promise<Array<{ wooId: number; revenue: number; unitsSold: number; orderCount: number }>> {
        try {
            const response = await esClient.search({
                index: 'orders',
                size: 0,
                query: {
                    bool: {
                        must: [
                            { term: { accountId } },
                            { terms: { status: statuses } },
                            {
                                range: {
                                    date_created: {
                                        gte: startDate.toISOString(),
                                        lte: endDate.toISOString(),
                                    },
                                },
                            },
                        ],
                    },
                },
                aggs: {
                    line_items_nested: {
                        nested: { path: 'line_items' },
                        aggs: {
                            by_product: {
                                terms: {
                                    field: 'line_items.productId',
                                    size: 10000,
                                },
                                aggs: {
                                    total_revenue: { sum: { field: 'line_items.total' } },
                                    total_units: { sum: { field: 'line_items.quantity' } },
                                    order_count: {
                                        reverse_nested: {},
                                        aggs: {
                                            count: { cardinality: { field: 'id' } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            const buckets = (((response.aggregations as ESBucket)?.line_items_nested as ESBucket)?.by_product as ESBucket)?.buckets as ESBucket[] || [];

            return buckets.map((b: ESBucket) => ({
                wooId: b.key as number,
                revenue: (b.total_revenue as ESBucket)?.value as number || 0,
                unitsSold: (b.total_units as ESBucket)?.value as number || 0,
                orderCount: ((b.order_count as ESBucket)?.count as ESBucket)?.value as number || 0,
            }));
        } catch (error: unknown) {
            Logger.warn('[ProductPerformanceService] ES order metrics query failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }
}
