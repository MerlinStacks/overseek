/**
 * Inventory Forecasting Utilities
 *
 * Core algorithms for SKU-level demand prediction with seasonality detection.
 * Follows the Domain-Specific Utility pattern established in Phase 13.
 */

import { ANALYTICS_CONFIG } from './analyticsConfig';


export type StockoutRisk = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TrendDirection = 'up' | 'down' | 'stable';

export interface DemandPrediction {
    dailyDemand: number;
    confidence: number;  // 0-100
    trendDirection: TrendDirection;
    trendPercent: number;
    seasonalityFactor: number;
}

export interface ForecastConfig {
    minHistoryDays: number;
    defaultForecastDays: number;
    safetyStockDays: number;
    defaultLeadTimeDays: number;
    riskThresholds: {
        critical: number;
        high: number;
        medium: number;
    };
    wmaWeights: readonly number[];
}


export function getForecastConfig(): ForecastConfig {
    return ANALYTICS_CONFIG.forecasting;
}


/**
 * Calculate weighted moving average with bias toward recent data.
 * Splits data into segments and applies weights (most recent = highest weight).
 *
 * @param dailySales Array of daily sales values (oldest to newest)
 * @param weights Array of weights, sum should equal 1 (e.g., [0.4, 0.3, 0.2, 0.1])
 * @returns Weighted average daily demand
 */
export function weightedMovingAverage(
    dailySales: number[],
    weights: readonly number[] = [0.4, 0.3, 0.2, 0.1]
): number {
    if (dailySales.length === 0) return 0;
    if (dailySales.length === 1) return dailySales[0];

    // Segment data into chunks based on weights
    const segmentSize = Math.ceil(dailySales.length / weights.length);
    const segments: number[] = [];

    for (let i = 0; i < weights.length; i++) {
        const start = dailySales.length - (segmentSize * (weights.length - i));
        const end = start + segmentSize;
        const segment = dailySales.slice(Math.max(0, start), Math.min(dailySales.length, end));

        if (segment.length > 0) {
            const avg = segment.reduce((a, b) => a + b, 0) / segment.length;
            segments.push(avg);
        }
    }

    // Apply weights (reverse order: most recent segment gets highest weight)
    let weightedSum = 0;
    let weightSum = 0;
    for (let i = 0; i < segments.length; i++) {
        const weight = weights[i] || weights[weights.length - 1];
        weightedSum += segments[segments.length - 1 - i] * weight;
        weightSum += weight;
    }

    return weightSum > 0 ? weightedSum / weightSum : 0;
}


/**
 * Calculate monthly seasonality coefficients from historical sales.
 * Returns a multiplier for each month (1.0 = average, >1 = above average).
 *
 * @param monthlySales Map of month number (1-12) to total sales
 * @returns Map of month number to seasonality coefficient
 */
export function calculateSeasonalityCoefficients(
    monthlySales: Map<number, number>
): Map<number, number> {
    const coefficients = new Map<number, number>();

    if (monthlySales.size === 0) {
        // Default: no seasonality adjustment
        for (let m = 1; m <= 12; m++) {
            coefficients.set(m, 1.0);
        }
        return coefficients;
    }

    // Calculate average monthly sales
    const values = Array.from(monthlySales.values());
    const avgMonthly = values.reduce((a, b) => a + b, 0) / values.length;

    if (avgMonthly === 0) {
        for (let m = 1; m <= 12; m++) {
            coefficients.set(m, 1.0);
        }
        return coefficients;
    }

    // Calculate coefficient for each month with data
    for (const [month, sales] of monthlySales) {
        coefficients.set(month, sales / avgMonthly);
    }

    // Fill in missing months with 1.0 (average)
    for (let m = 1; m <= 12; m++) {
        if (!coefficients.has(m)) {
            coefficients.set(m, 1.0);
        }
    }

    return coefficients;
}

/**
 * Get seasonality factor for a specific month.
 */
export function getSeasonalityFactor(
    targetMonth: number,
    coefficients: Map<number, number>
): number {
    return coefficients.get(targetMonth) ?? 1.0;
}


/**
 * Calculate linear regression slope from daily sales data.
 * Returns the daily trend (positive = growing, negative = declining).
 *
 * @param dailySales Array of daily sales values (oldest to newest)
 * @returns { slope, intercept }
 */
export function calculateLinearTrend(
    dailySales: number[]
): { slope: number; intercept: number } {
    const n = dailySales.length;
    if (n < 2) return { slope: 0, intercept: dailySales[0] ?? 0 };

    const x = dailySales.map((_, i) => i);
    const y = dailySales;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
    const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return { slope: 0, intercept: sumY / n };

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
}

/**
 * Classify trend direction based on percentage change.
 */
export function classifyTrend(
    previousAvg: number,
    currentAvg: number,
    threshold: number = 5
): { direction: TrendDirection; percent: number } {
    if (previousAvg === 0) {
        return {
            direction: currentAvg > 0 ? 'up' : 'stable',
            percent: currentAvg > 0 ? 100 : 0
        };
    }

    const percent = Math.round(((currentAvg - previousAvg) / previousAvg) * 100);

    let direction: TrendDirection = 'stable';
    if (percent > threshold) direction = 'up';
    else if (percent < -threshold) direction = 'down';

    return { direction, percent };
}


/**
 * Predict daily demand using ensemble approach:
 * - Weighted Moving Average (recent bias)
 * - Seasonality adjustment
 * - Linear trend component
 *
 * @param historicalDaily Daily sales array (oldest to newest)
 * @param targetMonth Month to forecast for (1-12)
 * @param seasonalityCoeffs Monthly seasonality coefficients
 * @returns DemandPrediction with demand, confidence, and trend info
 */
export function predictDailyDemand(
    historicalDaily: number[],
    targetMonth: number,
    seasonalityCoeffs: Map<number, number>
): DemandPrediction {
    const config = getForecastConfig();

    // Edge case: No data
    if (historicalDaily.length === 0) {
        return {
            dailyDemand: 0,
            confidence: 0,
            trendDirection: 'stable',
            trendPercent: 0,
            seasonalityFactor: 1.0
        };
    }

    // 1. Weighted Moving Average
    const wma = weightedMovingAverage(historicalDaily, config.wmaWeights);

    // 2. Seasonality Factor
    const seasonalityFactor = getSeasonalityFactor(targetMonth, seasonalityCoeffs);

    // 3. Linear Trend (only if enough data)
    const { slope } = calculateLinearTrend(historicalDaily);

    // 4. Trend direction from comparing recent vs older periods
    const midpoint = Math.floor(historicalDaily.length / 2);
    const olderAvg = historicalDaily.slice(0, midpoint).reduce((a, b) => a + b, 0) / Math.max(1, midpoint);
    const recentAvg = historicalDaily.slice(midpoint).reduce((a, b) => a + b, 0) / Math.max(1, historicalDaily.length - midpoint);
    const { direction: trendDirection, percent: trendPercent } = classifyTrend(olderAvg, recentAvg);

    // 5. Combine: WMA * seasonality + small trend adjustment
    // Trend adjustment is capped to prevent runaway predictions
    const trendAdjustment = Math.max(-0.3, Math.min(0.3, slope * 7)); // 7-day projection, capped at ±30%
    const dailyDemand = Math.max(0, wma * seasonalityFactor + trendAdjustment);

    // 6. Confidence based on data quality
    const confidence = calculateConfidence(historicalDaily.length, seasonalityCoeffs.size);

    return {
        dailyDemand: Math.round(dailyDemand * 100) / 100,
        confidence,
        trendDirection,
        trendPercent,
        seasonalityFactor: Math.round(seasonalityFactor * 100) / 100
    };
}

/**
 * Calculate confidence score based on data quality.
 */
function calculateConfidence(dataPoints: number, monthsCovered: number): number {
    const config = getForecastConfig();

    // Base confidence from data volume
    let confidence = 0;

    if (dataPoints >= 365) {
        confidence = 90;  // Full year = high confidence
    } else if (dataPoints >= 180) {
        confidence = 80;
    } else if (dataPoints >= 90) {
        confidence = 70;
    } else if (dataPoints >= config.minHistoryDays) {
        confidence = 50 + (dataPoints - config.minHistoryDays) * 0.5;
    } else if (dataPoints >= 7) {
        confidence = 30 + (dataPoints - 7) * 1.5;
    } else {
        confidence = dataPoints * 4;  // Very low for < 7 days
    }

    // Boost for seasonal coverage
    if (monthsCovered >= 12) confidence += 5;
    else if (monthsCovered >= 6) confidence += 3;

    return Math.min(100, Math.round(confidence));
}


/**
 * Classify stockout risk based on days remaining vs lead time.
 *
 * @param daysRemaining Predicted days until stockout
 * @param leadTimeDays Supplier lead time in days
 * @returns Risk classification
 */
export function classifyStockoutRisk(
    daysRemaining: number,
    leadTimeDays: number
): StockoutRisk {
    const config = getForecastConfig();
    const effectiveThreshold = Math.max(leadTimeDays, config.riskThresholds.critical);

    // Already out of stock
    if (daysRemaining <= 0) return 'CRITICAL';

    // Less than lead time + safety buffer
    if (daysRemaining <= effectiveThreshold) return 'CRITICAL';

    // Within high-risk threshold
    if (daysRemaining <= config.riskThresholds.high) return 'HIGH';

    // Within medium-risk threshold
    if (daysRemaining <= config.riskThresholds.medium) return 'MEDIUM';

    return 'LOW';
}

/**
 * Calculate days until stockout given current stock and daily demand.
 */
export function calculateDaysUntilStockout(
    currentStock: number,
    dailyDemand: number
): number {
    if (dailyDemand <= 0) return 999;  // No demand = infinite days
    if (currentStock <= 0) return 0;    // Already out

    return Math.floor(currentStock / dailyDemand);
}


/**
 * Calculate recommended reorder quantity.
 * Formula: (Lead Time * Daily Demand) + (Safety Stock Days * Daily Demand)
 *
 * @param dailyDemand Predicted daily demand
 * @param leadTimeDays Supplier lead time
 * @param safetyStockDays Additional buffer days
 * @returns Recommended order quantity (rounded up)
 */
export function calculateReorderQuantity(
    dailyDemand: number,
    leadTimeDays: number,
    safetyStockDays: number
): number {
    if (dailyDemand <= 0) return 0;

    const leadTimeQty = dailyDemand * leadTimeDays;
    const safetyQty = dailyDemand * safetyStockDays;

    return Math.ceil(leadTimeQty + safetyQty);
}

/**
 * Calculate reorder point (stock level at which to reorder).
 */
export function calculateReorderPoint(
    dailyDemand: number,
    leadTimeDays: number,
    safetyStockDays: number
): number {
    return Math.ceil(dailyDemand * (leadTimeDays + safetyStockDays));
}
