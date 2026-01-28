/**
 * Inventory Forecast Service
 *
 * AI-powered SKU-level demand prediction with proactive stockout alerts.
 * Uses ensemble forecasting (WMA + seasonality + trend) for accurate predictions.
 */

import { prisma } from '../../utils/prisma';
import { esClient } from '../../utils/elastic';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';
import { ANALYTICS_CONFIG } from './utils/analyticsConfig';
import {
    predictDailyDemand,
    calculateSeasonalityCoefficients,
    calculateDaysUntilStockout,
    classifyStockoutRisk,
    calculateReorderQuantity,
    type StockoutRisk,
    type TrendDirection
} from './utils/forecastUtils';

// ============================================================================
// Types
// ============================================================================

export interface SkuForecast {
    id: string;
    wooId: number;
    /** For variations, the parent product's WooCommerce ID for navigation */
    parentWooId?: number;
    name: string;
    sku: string | null;
    image: string | null;
    currentStock: number;
    dailyDemand: number;
    /** Demand derived from BOM consumption (parent products using this as a component) */
    derivedDemand: number;
    forecastedDemand: number;
    daysUntilStockout: number;
    stockoutRisk: StockoutRisk;
    confidence: number;
    seasonalityFactor: number;
    trendDirection: TrendDirection;
    trendPercent: number;
    recommendedReorderQty: number;
    supplierLeadTime: number | null;
    reorderPoint: number;
}

/** Maps a component product ID to its BOM usage across parent products */
interface BOMComponentMapping {
    componentProductId: string;
    componentWooId: number;
    parentMappings: Array<{
        parentProductId: string;
        parentWooId: number;
        parentVariationId: number;
        quantity: number; // BOMItem.quantity (how many of this component per parent unit)
        wasteFactor: number; // BOMItem.wasteFactor (e.g., 0.10 for 10% waste)
    }>;
}

export interface StockoutAlert {
    critical: SkuForecast[];
    high: SkuForecast[];
    medium: SkuForecast[];
    summary: {
        totalAtRisk: number;
        criticalCount: number;
        highCount: number;
        mediumCount: number;
    };
}

export interface ForecastCurvePoint {
    date: string;
    predictedStock: number;
    upperBound: number;
    lowerBound: number;
}

export interface SkuForecastDetail extends SkuForecast {
    forecastCurve: ForecastCurvePoint[];
    historicalDemand: { date: string; quantity: number }[];
}

// ============================================================================
// Service
// ============================================================================

export class InventoryForecastService {

    /**
     * Get forecasts for all managed-stock products.
     * Includes BOM-derived demand: if a component is used in assembled products,
     * the demand from parent product sales is factored into the component's forecast.
     */
    static async getSkuForecasts(
        accountId: string,
        daysToForecast: number = ANALYTICS_CONFIG.forecasting.defaultForecastDays
    ): Promise<SkuForecast[]> {
        try {
            // 1. Get all managed-stock products
            const products = await this.getManagedStockProducts(accountId);
            if (products.length === 0) return [];

            // Separate simple products from variations for proper ES querying
            const simpleProducts = products.filter(p => !p.isVariation);
            const variations = products.filter(p => p.isVariation);

            // 2. Get historical sales data from Elasticsearch (direct sales)
            // Query by productId for simple products, by variationId for variations
            const salesData = await this.getHistoricalSales(
                accountId,
                simpleProducts.map(p => p.wooId),
                variations.map(v => v.wooId),
                365
            );

            // 3. Get BOM component mappings and calculate derived demand
            // Separate product IDs from variation wooIds for proper BOM lookup
            const productIds = simpleProducts.map(p => p.id);
            const internalProductIds = products.filter(p => p.wooId === 0).map(p => p.id);
            const variationWooIds = variations.map(v => v.wooId);
            const bomMappings = await this.getBOMComponentMappings(
                accountId,
                [...productIds, ...internalProductIds],
                variationWooIds,
                products
            );
            const derivedDemandByComponent = await this.calculateBOMDerivedDemand(
                accountId,
                bomMappings,
                90 // Use 90 days for consistency with direct sales prediction window
            );

            // Debug: Log BOM-derived demand calculation results
            Logger.debug('[InventoryForecastService] BOM-derived demand calculation', {
                accountId,
                productCount: productIds.length,
                variationCount: variationWooIds.length,
                bomMappingsFound: bomMappings.length,
                componentsWithDerivedDemand: derivedDemandByComponent.size,
                derivedDemandEntries: Array.from(derivedDemandByComponent.entries()).slice(0, 5)
            });

            // 4. Calculate monthly seasonality from full year data (direct sales only)
            const seasonalityByProduct = this.calculateProductSeasonality(salesData);

            // 5. Generate forecasts for each product
            const targetMonth = new Date().getMonth() + 1; // 1-12
            const forecasts: SkuForecast[] = [];

            for (const product of products) {
                const productSales = salesData.get(product.wooId) || [];
                const seasonality = seasonalityByProduct.get(product.wooId) || new Map();

                // Get daily sales (last 90 days for prediction)
                const dailySales = this.aggregateToDailySales(productSales, 90);

                // Predict direct demand using ensemble algorithm
                const prediction = predictDailyDemand(dailySales, targetMonth, seasonality);

                // Add BOM-derived demand (already calculated as daily average)
                const derivedDemand = derivedDemandByComponent.get(product.id) || 0;
                const totalDailyDemand = prediction.dailyDemand + derivedDemand;

                // Calculate stockout metrics using TOTAL demand (direct + derived)
                const daysUntilStockout = calculateDaysUntilStockout(
                    product.currentStock,
                    totalDailyDemand
                );

                const leadTime = product.supplierLeadTime || ANALYTICS_CONFIG.forecasting.defaultLeadTimeDays;
                const stockoutRisk = classifyStockoutRisk(daysUntilStockout, leadTime);

                const reorderQty = calculateReorderQuantity(
                    totalDailyDemand,
                    leadTime,
                    ANALYTICS_CONFIG.forecasting.safetyStockDays
                );

                const reorderPoint = Math.ceil(
                    totalDailyDemand * (leadTime + ANALYTICS_CONFIG.forecasting.safetyStockDays)
                );

                forecasts.push({
                    id: product.id,
                    wooId: product.wooId,
                    parentWooId: product.parentWooId,
                    name: product.name,
                    sku: product.sku,
                    image: product.image,
                    currentStock: product.currentStock,
                    dailyDemand: totalDailyDemand,
                    derivedDemand, // Expose how much comes from BOM consumption
                    forecastedDemand: Math.round(totalDailyDemand * daysToForecast),
                    daysUntilStockout,
                    stockoutRisk,
                    confidence: prediction.confidence,
                    seasonalityFactor: prediction.seasonalityFactor,
                    trendDirection: prediction.trendDirection,
                    trendPercent: prediction.trendPercent,
                    recommendedReorderQty: reorderQty,
                    supplierLeadTime: product.supplierLeadTime,
                    reorderPoint
                });
            }

            // Sort by risk (CRITICAL first, then by days until stockout)
            return this.sortByRisk(forecasts);

        } catch (error) {
            Logger.error('[InventoryForecastService] Error generating SKU forecasts', { error, accountId });
            throw error;
        }
    }

    /**
     * Get stockout alerts grouped by risk level.
     */
    static async getStockoutAlerts(
        accountId: string,
        thresholdDays: number = ANALYTICS_CONFIG.forecasting.riskThresholds.medium
    ): Promise<StockoutAlert> {
        const allForecasts = await this.getSkuForecasts(accountId);

        const critical = allForecasts.filter(f => f.stockoutRisk === 'CRITICAL');
        const high = allForecasts.filter(f => f.stockoutRisk === 'HIGH');
        const medium = allForecasts.filter(f =>
            f.stockoutRisk === 'MEDIUM' && f.daysUntilStockout <= thresholdDays
        );

        return {
            critical,
            high,
            medium,
            summary: {
                totalAtRisk: critical.length + high.length + medium.length,
                criticalCount: critical.length,
                highCount: high.length,
                mediumCount: medium.length
            }
        };
    }

    /**
     * Get detailed forecast for a single product.
     */
    static async getSkuForecastDetail(
        accountId: string,
        wooId: number
    ): Promise<SkuForecastDetail | null> {
        try {
            // Get base forecast
            const allForecasts = await this.getSkuForecasts(accountId);
            const forecast = allForecasts.find(f => f.wooId === wooId);
            if (!forecast) return null;

            // Get historical daily sales for chart
            // For a detail view, we query by productId (simple) or variationId (variation)
            // We don't know here if it's a variation, so query both ways
            const salesData = await this.getHistoricalSales(accountId, [wooId], [wooId], 90);
            const productSales = salesData.get(wooId) || [];

            // Aggregate to daily for historical chart
            const historicalDemand = this.aggregateToHistoricalDemand(productSales);

            // Generate 30-day forecast curve with confidence bands
            const forecastCurve = this.generateForecastCurve(
                forecast.currentStock,
                forecast.dailyDemand,
                forecast.confidence,
                30
            );

            return {
                ...forecast,
                forecastCurve,
                historicalDemand
            };

        } catch (error) {
            Logger.error('[InventoryForecastService] Error getting SKU detail', { error, accountId, wooId });
            return null;
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Get all products with managed stock that are "leaf" products.
     * Excludes assembled products (those with BOM items) - we forecast their components instead.
     * Includes: simple products, components, and variations with managed stock.
     * 
     * Filtering logic:
     * - Parent products: excluded if they have a parent-level BOM (variationId=0) with items
     * - Variations: excluded if:
     *   1. The parent has a parent-level BOM with items, OR
     *   2. The variation has its own BOM (variationId=wooId) with items
     */
    private static async getManagedStockProducts(accountId: string): Promise<Array<{
        id: string;
        wooId: number;
        parentWooId?: number;
        name: string;
        sku: string | null;
        image: string | null;
        currentStock: number;
        supplierLeadTime: number | null;
        isVariation?: boolean;
    }>> {
        // 1. Get all products with their BOMs (including variation-specific BOMs)
        const products = await prisma.wooProduct.findMany({
            where: { accountId },
            select: {
                id: true,
                wooId: true,
                name: true,
                sku: true,
                mainImage: true,
                rawData: true,
                supplier: {
                    select: { leadTimeDefault: true }
                },
                // Include BOMs to check if product is assembled
                // variationId=0 means parent BOM, variationId>0 means variation-specific BOM
                boms: {
                    select: {
                        variationId: true,
                        items: {
                            select: { id: true },
                            take: 1 // Only need to know if any items exist
                        }
                    }
                },
                // Include variations with managed stock
                variations: {
                    select: {
                        id: true,
                        wooId: true,
                        sku: true,
                        stockQuantity: true,
                        manageStock: true,
                        rawData: true
                    }
                }
            }
        });

        const result: Array<{
            id: string;
            wooId: number;
            parentWooId?: number;
            name: string;
            sku: string | null;
            image: string | null;
            currentStock: number;
            supplierLeadTime: number | null;
            isVariation?: boolean;
        }> = [];

        for (const p of products) {
            // Check if product has a parent-level BOM with items (variationId=0)
            const hasParentBOM = p.boms.some(bom => bom.variationId === 0 && bom.items.length > 0);

            // Parent products: only include if no parent BOM and has managed stock
            if (!hasParentBOM) {
                const raw = p.rawData as { manage_stock?: boolean; stock_quantity?: number };
                if (raw.manage_stock && typeof raw.stock_quantity === 'number') {
                    result.push({
                        id: p.id,
                        wooId: p.wooId,
                        name: p.name,
                        sku: p.sku,
                        image: p.mainImage,
                        currentStock: raw.stock_quantity,
                        supplierLeadTime: p.supplier?.leadTimeDefault || null
                    });
                }
            }

            // Variations: only include if parent has no BOM AND variation has no its own BOM
            // Skip all variations if the parent has a parent-level BOM
            if (hasParentBOM) continue;

            for (const v of p.variations) {
                // Check if this specific variation has its own BOM with items
                const variationHasBOM = p.boms.some(
                    bom => bom.variationId === v.wooId && bom.items.length > 0
                );
                if (variationHasBOM) continue;

                // Check variation's manage_stock setting
                const varRaw = v.rawData as { manage_stock?: boolean; stock_quantity?: number } | null;
                const managesStock = v.manageStock || varRaw?.manage_stock;
                const stockQty = v.stockQuantity ?? varRaw?.stock_quantity;

                if (managesStock && typeof stockQty === 'number') {
                    // Build variation name from attributes (e.g., "Size: Large, Color: Blue")
                    const varRawFull = v.rawData as {
                        manage_stock?: boolean;
                        stock_quantity?: number;
                        attributes?: Array<{ name: string; option: string }>;
                    } | null;

                    let variationSuffix = 'Variation';
                    if (varRawFull?.attributes && varRawFull.attributes.length > 0) {
                        // Extract just the option values (e.g., "Blue, Large")
                        variationSuffix = varRawFull.attributes.map(a => a.option).join(', ');
                    } else if (v.sku) {
                        // Fallback to SKU if no attributes
                        variationSuffix = v.sku;
                    }

                    result.push({
                        id: v.id,
                        wooId: v.wooId,
                        parentWooId: p.wooId,
                        name: `${p.name} - ${variationSuffix}`,
                        sku: v.sku,
                        image: p.mainImage, // Use parent image for variations
                        currentStock: stockQty,
                        supplierLeadTime: p.supplier?.leadTimeDefault || null,
                        isVariation: true
                    });
                }
            }
        }


        // 2. Fetch internal products (component-only, not synced to WooCommerce)
        // These are always included in forecasts since they're managed locally
        const internalProducts = await prisma.internalProduct.findMany({
            where: { accountId },
            select: {
                id: true,
                name: true,
                sku: true,
                mainImage: true,
                stockQuantity: true,
                supplier: {
                    select: { leadTimeDefault: true }
                }
            }
        });

        for (const ip of internalProducts) {
            result.push({
                id: ip.id,
                wooId: 0, // Internal products have no WooCommerce ID
                name: `[Internal] ${ip.name}`,
                sku: ip.sku,
                image: ip.mainImage,
                currentStock: ip.stockQuantity,
                supplierLeadTime: ip.supplier?.leadTimeDefault || null
            });
        }

        return result;
    }


    /**
     * Get historical sales data from Elasticsearch.
     * Queries by productId for simple products and by variationId for variations.
     * Returns Map<wooId, Array<{date, quantity}>>
     */
    private static async getHistoricalSales(
        accountId: string,
        simpleProductWooIds: number[],
        variationWooIds: number[],
        days: number
    ): Promise<Map<number, Array<{ date: string; quantity: number }>>> {
        const salesMap = new Map<number, Array<{ date: string; quantity: number }>>();

        // If no IDs to query, return empty map
        if (simpleProductWooIds.length === 0 && variationWooIds.length === 0) {
            return salesMap;
        }

        // Convert to Sets for O(1) lookups when processing buckets
        const simpleProductIdSet = new Set(simpleProductWooIds);
        const variationIdSet = new Set(variationWooIds);

        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Build the nested query to match either productId OR variationId
            // ES mapping uses keyword type, so convert numeric IDs to strings
            const nestedShouldClauses: any[] = [];
            if (simpleProductWooIds.length > 0) {
                nestedShouldClauses.push({
                    terms: { 'line_items.productId': simpleProductWooIds.map(String) }
                });
            }
            if (variationWooIds.length > 0) {
                nestedShouldClauses.push({
                    terms: { 'line_items.variationId': variationWooIds.map(String) }
                });
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
                                    date_created: {
                                        gte: startDate.toISOString()
                                    }
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
                        date_histogram: {
                            field: 'date_created',
                            calendar_interval: 'day'
                        },
                        aggs: {
                            line_items_nested: {
                                nested: { path: 'line_items' },
                                aggs: {
                                    // Aggregate by productId for simple products
                                    by_product: {
                                        terms: {
                                            field: 'line_items.productId',
                                            size: 10000
                                        },
                                        aggs: {
                                            total_qty: {
                                                sum: { field: 'line_items.quantity' }
                                            }
                                        }
                                    },
                                    // Aggregate by variationId for variations
                                    by_variation: {
                                        terms: {
                                            field: 'line_items.variationId',
                                            size: 10000
                                        },
                                        aggs: {
                                            total_qty: {
                                                sum: { field: 'line_items.quantity' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            // Parse aggregation results
            const dayBuckets = (response.aggregations as any)?.by_day?.buckets || [];

            for (const dayBucket of dayBuckets) {
                const date = new Date(dayBucket.key_as_string || dayBucket.key).toISOString().split('T')[0];

                // Process simple products (by productId)
                const productBuckets = dayBucket.line_items_nested?.by_product?.buckets || [];
                for (const productBucket of productBuckets) {
                    // ES keyword fields return string keys - convert to number for Map key
                    const productId = Number(productBucket.key);
                    if (isNaN(productId) || !simpleProductIdSet.has(productId)) continue;

                    const quantity = productBucket.total_qty?.value || 0;
                    if (quantity <= 0) continue;

                    if (!salesMap.has(productId)) {
                        salesMap.set(productId, []);
                    }
                    salesMap.get(productId)!.push({ date, quantity });
                }

                // Process variations (by variationId)
                const variationBuckets = dayBucket.line_items_nested?.by_variation?.buckets || [];
                for (const variationBucket of variationBuckets) {
                    // ES keyword fields return string keys - convert to number for Map key
                    const variationId = Number(variationBucket.key);
                    // Skip NaN, 0 (means no variation), and non-matching IDs
                    if (isNaN(variationId) || variationId === 0 || !variationIdSet.has(variationId)) continue;

                    const quantity = variationBucket.total_qty?.value || 0;
                    if (quantity <= 0) continue;

                    if (!salesMap.has(variationId)) {
                        salesMap.set(variationId, []);
                    }
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


    /**
     * Calculate monthly seasonality coefficients per product.
     */
    private static calculateProductSeasonality(
        salesData: Map<number, Array<{ date: string; quantity: number }>>
    ): Map<number, Map<number, number>> {
        const result = new Map<number, Map<number, number>>();

        for (const [productId, sales] of salesData) {
            // Group by month
            const monthlySales = new Map<number, number>();

            for (const { date, quantity } of sales) {
                const month = new Date(date).getMonth() + 1; // 1-12
                monthlySales.set(month, (monthlySales.get(month) || 0) + quantity);
            }

            result.set(productId, calculateSeasonalityCoefficients(monthlySales));
        }

        return result;
    }

    /**
     * Aggregate sales to daily totals for the last N days.
     */
    private static aggregateToDailySales(
        sales: Array<{ date: string; quantity: number }>,
        days: number
    ): number[] {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        // Filter to last N days and sort by date
        const filtered = sales
            .filter(s => s.date >= cutoffStr)
            .sort((a, b) => a.date.localeCompare(b.date));

        // Fill gaps with zeros for days with no sales
        const dailyMap = new Map<string, number>();
        for (const { date, quantity } of filtered) {
            dailyMap.set(date, (dailyMap.get(date) || 0) + quantity);
        }

        // Generate all dates in range
        const result: number[] = [];
        const current = new Date(cutoff);
        const today = new Date();

        while (current <= today) {
            const dateStr = current.toISOString().split('T')[0];
            result.push(dailyMap.get(dateStr) || 0);
            current.setDate(current.getDate() + 1);
        }

        return result;
    }

    /**
     * Convert sales data to historical demand format for charts.
     */
    private static aggregateToHistoricalDemand(
        sales: Array<{ date: string; quantity: number }>
    ): Array<{ date: string; quantity: number }> {
        const dailyMap = new Map<string, number>();

        for (const { date, quantity } of sales) {
            dailyMap.set(date, (dailyMap.get(date) || 0) + quantity);
        }

        return Array.from(dailyMap.entries())
            .map(([date, quantity]) => ({ date, quantity }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    /**
     * Generate forecast curve with confidence bands.
     */
    private static generateForecastCurve(
        currentStock: number,
        dailyDemand: number,
        confidence: number,
        days: number
    ): ForecastCurvePoint[] {
        const curve: ForecastCurvePoint[] = [];

        // Confidence band width (lower confidence = wider bands)
        const bandWidth = (100 - confidence) / 100 * 0.5; // Up to 50% variation at 0 confidence

        for (let i = 0; i <= days; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];

            const predictedStock = Math.max(0, currentStock - dailyDemand * i);
            const variation = predictedStock * bandWidth * (i / days); // Wider as we go further

            curve.push({
                date: dateStr,
                predictedStock: Math.round(predictedStock),
                upperBound: Math.round(predictedStock + variation),
                lowerBound: Math.round(Math.max(0, predictedStock - variation))
            });
        }

        return curve;
    }

    /**
     * Get BOM component mappings for managed products.
     * Returns a map of component product IDs to their parent BOM relationships.
     * This tells us which products use each component and how many units per assembly.
     * 
     * Handles:
     * - WooProduct components (childProductId)
     * - ProductVariation components (childVariationId)
     * - InternalProduct components (internalProductId)
     */
    private static async getBOMComponentMappings(
        accountId: string,
        productIds: string[],
        variationWooIds: number[],
        products: Array<{ id: string; wooId: number; isVariation?: boolean }>
    ): Promise<BOMComponentMapping[]> {
        if (productIds.length === 0 && variationWooIds.length === 0) return [];

        // Build OR conditions for the query
        const orConditions: Array<Record<string, unknown>> = [];
        if (productIds.length > 0) {
            orConditions.push({ childProductId: { in: productIds } });
            orConditions.push({ internalProductId: { in: productIds } });
        }
        if (variationWooIds.length > 0) {
            orConditions.push({ childVariationId: { in: variationWooIds } });
        }

        // Find all BOMItems matching our components
        const bomItems = await prisma.bOMItem.findMany({
            where: { OR: orConditions },
            select: {
                childProductId: true,
                childVariationId: true,
                internalProductId: true,
                quantity: true,
                wasteFactor: true,
                bom: {
                    select: {
                        productId: true,
                        variationId: true,
                        product: {
                            select: {
                                accountId: true,
                                wooId: true
                            }
                        }
                    }
                }
            }
        });

        // Filter to only BOMs belonging to this account
        const accountBomItems = bomItems.filter(
            item => item.bom.product.accountId === accountId
        );

        Logger.debug('[InventoryForecastService] getBOMComponentMappings query', {
            accountId,
            productIdsSearched: productIds.length,
            variationWooIdsSearched: variationWooIds.length,
            bomItemsFound: bomItems.length,
            accountBomItemsAfterFilter: accountBomItems.length
        });

        // Create a lookup map from wooId to product id for variations
        const variationWooIdToId = new Map<number, string>();
        for (const p of products) {
            if (p.isVariation && p.wooId > 0) {
                variationWooIdToId.set(p.wooId, p.id);
            }
        }

        // Group by component product ID
        const mappingsByComponent = new Map<string, BOMComponentMapping>();

        for (const item of accountBomItems) {
            // Determine which component ID is being used
            let componentId: string | null = null;
            let componentWooId = 0;

            if (item.childVariationId && variationWooIdToId.has(item.childVariationId)) {
                // This is a variation component - map wooId back to our product id
                componentId = variationWooIdToId.get(item.childVariationId)!;
                componentWooId = item.childVariationId;
            } else if (item.childProductId) {
                componentId = item.childProductId;
                const component = await prisma.wooProduct.findUnique({
                    where: { id: componentId },
                    select: { wooId: true }
                });
                componentWooId = component?.wooId || 0;
            } else if (item.internalProductId) {
                componentId = item.internalProductId;
                // Internal products have no wooId, remains 0
            }

            if (!componentId) continue;

            if (!mappingsByComponent.has(componentId)) {
                mappingsByComponent.set(componentId, {
                    componentProductId: componentId,
                    componentWooId,
                    parentMappings: []
                });
            }

            mappingsByComponent.get(componentId)!.parentMappings.push({
                parentProductId: item.bom.productId,
                parentWooId: item.bom.product.wooId,
                parentVariationId: item.bom.variationId,
                quantity: Number(item.quantity),
                wasteFactor: Number(item.wasteFactor)
            });
        }

        return Array.from(mappingsByComponent.values());
    }

    /**
     * Calculate BOM-derived demand for components based on parent product sales.
     * For each component, sums up: (parent daily sales × BOM quantity × (1 + wasteFactor))
     * across all parent products that use this component.
     * 
     * @returns Map of component product ID → average daily derived demand
     */
    private static async calculateBOMDerivedDemand(
        accountId: string,
        bomMappings: BOMComponentMapping[],
        days: number
    ): Promise<Map<string, number>> {
        const derivedDemand = new Map<string, number>();

        if (bomMappings.length === 0) return derivedDemand;

        // Collect all unique parent product wooIds we need to query
        const parentWooIds = new Set<number>();
        const parentVariationWooIds = new Set<number>();

        for (const mapping of bomMappings) {
            for (const parent of mapping.parentMappings) {
                if (parent.parentVariationId > 0) {
                    // This BOM is for a specific variation
                    parentVariationWooIds.add(parent.parentVariationId);
                } else {
                    // This BOM is for the parent product
                    parentWooIds.add(parent.parentWooId);
                }
            }
        }

        // Fetch parent sales from Elasticsearch
        const parentSales = await this.getHistoricalSales(
            accountId,
            Array.from(parentWooIds),
            Array.from(parentVariationWooIds),
            days
        );

        // Calculate derived demand for each component
        for (const mapping of bomMappings) {
            let totalDerivedDemand = 0;

            for (const parent of mapping.parentMappings) {
                // Get the parent's wooId based on whether it's a parent BOM or variation BOM
                const parentLookupId = parent.parentVariationId > 0
                    ? parent.parentVariationId
                    : parent.parentWooId;

                const parentSalesData = parentSales.get(parentLookupId) || [];

                // Calculate total units sold by parent in the period
                const totalParentSold = parentSalesData.reduce(
                    (sum, sale) => sum + sale.quantity,
                    0
                );

                // Calculate average daily parent sales
                const avgDailyParentSales = days > 0 ? totalParentSold / days : 0;

                // Derived demand = parent sales × quantity per unit × (1 + waste factor)
                const effectiveQuantity = parent.quantity * (1 + parent.wasteFactor);
                totalDerivedDemand += avgDailyParentSales * effectiveQuantity;
            }

            // Store the total derived demand for this component
            if (totalDerivedDemand > 0) {
                derivedDemand.set(mapping.componentProductId, totalDerivedDemand);
            }
        }

        return derivedDemand;
    }

    /**
     * Sort forecasts by risk priority.
     */
    private static sortByRisk(forecasts: SkuForecast[]): SkuForecast[] {
        const riskOrder: Record<StockoutRisk, number> = {
            'CRITICAL': 0,
            'HIGH': 1,
            'MEDIUM': 2,
            'LOW': 3
        };

        return [...forecasts].sort((a, b) => {
            const riskDiff = riskOrder[a.stockoutRisk] - riskOrder[b.stockoutRisk];
            if (riskDiff !== 0) return riskDiff;

            // Within same risk, sort by days until stockout
            return a.daysUntilStockout - b.daysUntilStockout;
        });
    }
}
