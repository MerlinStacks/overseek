import { Logger } from '../../utils/logger';
import { ANALYTICS_CONFIG } from './utils/analyticsConfig';
import {
    predictDailyDemand,
    classifyStockoutRisk,
    calculateReorderQuantity,
} from './utils/forecastUtils';
import type {
    SkuForecast,
    StockoutAlert,
    SkuForecastDetail,
} from './inventory-forecast/types';
import { getManagedStockProducts, getOrderedInventory } from './inventory-forecast/queries';
import { getHistoricalSales } from './inventory-forecast/sales';
import { getBOMComponentMappings, calculateBOMDerivedDemand } from './inventory-forecast/bom';
import {
    calculateProductSeasonality,
    aggregateToDailySales,
    aggregateToHistoricalDemand,
    generateForecastCurve,
    calculateDaysUntilStockoutWithInbound,
    sortByRisk,
} from './inventory-forecast/calculations';

export class InventoryForecastService {
    static async getSkuForecasts(
        accountId: string,
        daysToForecast: number = ANALYTICS_CONFIG.forecasting.defaultForecastDays
    ): Promise<SkuForecast[]> {
        try {
            const [products, orderedInventory] = await Promise.all([
                getManagedStockProducts(accountId),
                getOrderedInventory(accountId)
            ]);
            if (products.length === 0) return [];

            const simpleProducts = products.filter(p => !p.isVariation);
            const variations = products.filter(p => p.isVariation);

            const salesData = await getHistoricalSales(
                accountId,
                simpleProducts.map(p => p.wooId),
                variations.map(v => v.wooId),
                365
            );

            const productIds = simpleProducts.map(p => p.id);
            const internalProductIds = products.filter(p => p.wooId === 0).map(p => p.id);
            const variationWooIds = variations.map(v => v.wooId);
            const bomMappings = await getBOMComponentMappings(
                accountId,
                [...productIds, ...internalProductIds],
                variationWooIds,
                products
            );
            const derivedDemandByComponent = await calculateBOMDerivedDemand(accountId, bomMappings, 90);

            Logger.debug('[InventoryForecastService] BOM-derived demand calculation', {
                accountId,
                productCount: productIds.length,
                variationCount: variationWooIds.length,
                bomMappingsFound: bomMappings.length,
                componentsWithDerivedDemand: derivedDemandByComponent.size,
                derivedDemandEntries: Array.from(derivedDemandByComponent.entries()).slice(0, 5)
            });

            const seasonalityByProduct = calculateProductSeasonality(salesData);
            const targetMonth = new Date().getMonth() + 1;
            const forecasts: SkuForecast[] = [];

            for (const product of products) {
                const productSales = salesData.get(product.wooId) || [];
                const seasonality = seasonalityByProduct.get(product.wooId) || new Map();
                const dailySales = aggregateToDailySales(productSales, 90);
                const prediction = predictDailyDemand(dailySales, targetMonth, seasonality);

                const derivedDemand = derivedDemandByComponent.get(product.id) || 0;
                const totalDailyDemand = prediction.dailyDemand + derivedDemand;

                const leadTime = product.supplierLeadTime ?? ANALYTICS_CONFIG.forecasting.defaultLeadTimeDays;
                const orderedItems = product.isVariation
                    ? orderedInventory.byVariation.get(`${product.productId}:${product.wooId}`) || []
                    : orderedInventory.byProduct.get(product.productId) || [];
                const today = new Date();
                today.setUTCHours(0, 0, 0, 0);
                const inboundArrivals = orderedItems.map(item => {
                    const expectedDate = item.expectedDate
                        ? new Date(item.expectedDate)
                        : new Date(item.orderDate || item.createdAt);
                    if (!item.expectedDate) expectedDate.setUTCDate(expectedDate.getUTCDate() + leadTime);
                    expectedDate.setUTCHours(0, 0, 0, 0);
                    return {
                        quantity: item.quantity,
                        expectedDate: expectedDate.toISOString(),
                        arrivalDay: Math.max(0, Math.ceil((expectedDate.getTime() - today.getTime()) / 86_400_000))
                    };
                });
                const inboundStock = orderedItems.reduce((sum, item) => sum + item.quantity, 0);
                const planningHorizon = leadTime + ANALYTICS_CONFIG.forecasting.safetyStockDays;
                const inboundWithinLeadTime = inboundArrivals
                    .filter(arrival => arrival.arrivalDay <= planningHorizon)
                    .reduce((sum, arrival) => sum + arrival.quantity, 0);
                const projectedStock = product.currentStock + inboundWithinLeadTime;
                const daysUntilStockout = calculateDaysUntilStockoutWithInbound(
                    product.currentStock,
                    totalDailyDemand,
                    inboundArrivals
                );
                const stockoutRisk = classifyStockoutRisk(daysUntilStockout, leadTime);
                const targetStock = calculateReorderQuantity(
                    totalDailyDemand,
                    leadTime,
                    ANALYTICS_CONFIG.forecasting.safetyStockDays
                );
                const reorderQty = Math.max(0, targetStock - projectedStock);
                const reorderPoint = Math.ceil(totalDailyDemand * (leadTime + ANALYTICS_CONFIG.forecasting.safetyStockDays));

                forecasts.push({
                    id: product.id,
                    wooId: product.wooId,
                    parentWooId: product.parentWooId,
                    name: product.name,
                    sku: product.sku,
                    image: product.image,
                    currentStock: product.currentStock,
                    inboundStock,
                    projectedStock,
                    inboundArrivals: inboundArrivals.map(({ quantity, expectedDate }) => ({ quantity, expectedDate })),
                    dailyDemand: totalDailyDemand,
                    derivedDemand,
                    forecastedDemand: Math.round(totalDailyDemand * daysToForecast),
                    daysUntilStockout,
                    stockoutRisk,
                    confidence: prediction.confidence,
                    seasonalityFactor: prediction.seasonalityFactor,
                    trendDirection: prediction.trendDirection,
                    trendPercent: prediction.trendPercent,
                    recommendedReorderQty: reorderQty,
                    supplierLeadTime: leadTime,
                    supplierLeadTimeMin: product.supplierLeadTimeMin,
                    supplierLeadTimeMax: product.supplierLeadTimeMax,
                    reorderPoint
                });
            }

            return sortByRisk(forecasts);
        } catch (error) {
            Logger.error('[InventoryForecastService] Error generating SKU forecasts', { error, accountId });
            throw error;
        }
    }

    static async getStockoutAlerts(
        accountId: string,
        thresholdDays: number = ANALYTICS_CONFIG.forecasting.riskThresholds.medium
    ): Promise<StockoutAlert> {
        const allForecasts = await this.getSkuForecasts(accountId);
        const critical = allForecasts.filter(f => f.stockoutRisk === 'CRITICAL');
        const high = allForecasts.filter(f => f.stockoutRisk === 'HIGH');
        const medium = allForecasts.filter(f => f.stockoutRisk === 'MEDIUM' && f.daysUntilStockout <= thresholdDays);
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

    static async getSkuForecastDetail(accountId: string, wooId: number): Promise<SkuForecastDetail | null> {
        try {
            const allForecasts = await this.getSkuForecasts(accountId);
            const forecast = allForecasts.find(f => f.wooId === wooId);
            if (!forecast) return null;

            const salesData = await getHistoricalSales(accountId, [wooId], [wooId], 90);
            const productSales = salesData.get(wooId) || [];
            const historicalDemand = aggregateToHistoricalDemand(productSales);
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            const inboundArrivals = forecast.inboundArrivals.map(arrival => ({
                quantity: arrival.quantity,
                arrivalDay: Math.max(0, Math.ceil((new Date(arrival.expectedDate).getTime() - today.getTime()) / 86_400_000))
            }));
            const forecastCurve = generateForecastCurve(
                forecast.currentStock,
                forecast.dailyDemand,
                forecast.confidence,
                30,
                inboundArrivals
            );

            return { ...forecast, forecastCurve, historicalDemand };
        } catch (error) {
            Logger.error('[InventoryForecastService] Error getting SKU detail', { error, accountId, wooId });
            return null;
        }
    }
}
