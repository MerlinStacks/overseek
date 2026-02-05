/**
 * Sales Forecasting Service
 * 
 * Extracted from SalesAnalytics for modularity.
 * Provides seasonality-aware and linear regression-based sales forecasting.
 */

import { Logger } from '../../utils/logger';
import { SalesAnalytics } from './sales';

/**
 * Converts a Date to 'YYYY-MM-DD' format in local time.
 * This ensures consistent date string comparison with Elasticsearch results.
 */
function toDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export class SalesForecastService {

    /**
     * Get Sales Forecast (Seasonality & YoY Growth Aware)
     * 
     * Uses year-over-year comparison with growth adjustment for seasonality.
     * Falls back to weighted moving average if insufficient YoY data.
     * Falls back to linear regression if insufficient recent data.
     * 
     * @returns Forecast array with confidence metadata
     */
    static async getSalesForecast(accountId: string, daysToForecast: number = 30) {
        try {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            // === Fetch Recent 30 Days (for growth calculation & fallback) ===
            const recentStart = new Date(today);
            recentStart.setDate(today.getDate() - 30);

            const recentData = await SalesAnalytics.getSalesOverTime(
                accountId,
                recentStart.toISOString(),
                today.toISOString(),
                'day'
            );

            // Create a lookup map for recent data by date string
            const recentDataMap = new Map<string, number>();
            for (const d of recentData) {
                recentDataMap.set(d.date, d.sales || 0);
            }

            // === Fetch Last Year's Equivalent Window ===
            // We need: (today - 30 days) to (today + daysToForecast), all shifted back 1 year
            const lastYearWindowStart = new Date(today);
            lastYearWindowStart.setFullYear(today.getFullYear() - 1);
            lastYearWindowStart.setDate(lastYearWindowStart.getDate() - 30);

            const lastYearWindowEnd = new Date(today);
            lastYearWindowEnd.setFullYear(today.getFullYear() - 1);
            lastYearWindowEnd.setDate(lastYearWindowEnd.getDate() + daysToForecast);

            const lastYearData = await SalesAnalytics.getSalesOverTime(
                accountId,
                lastYearWindowStart.toISOString(),
                lastYearWindowEnd.toISOString(),
                'day'
            );

            // Create a lookup map for last year's data by date string
            const lastYearDataMap = new Map<string, number>();
            for (const d of lastYearData) {
                lastYearDataMap.set(d.date, d.sales || 0);
            }

            // Determine if we have sufficient YoY data (at least 14 days in the forecast window)
            const lastYearTodayEquivalent = new Date(today);
            lastYearTodayEquivalent.setFullYear(today.getFullYear() - 1);

            let forecastDaysWithData = 0;
            for (let i = 1; i <= daysToForecast; i++) {
                const checkDate = new Date(lastYearTodayEquivalent);
                checkDate.setDate(lastYearTodayEquivalent.getDate() + i);
                if (lastYearDataMap.has(toDateString(checkDate))) {
                    forecastDaysWithData++;
                }
            }

            const hasEnoughYoYData = forecastDaysWithData >= Math.min(14, daysToForecast);

            // === EDGE CASE: Calculate confidence score based on data quality ===
            // - High: 90+ days of historical data AND YoY data available
            // - Medium: 30-90 days OR no YoY data but recent data available
            // - Low: <30 days of data - warn user predictions may be inaccurate
            const totalHistoricalDays = recentData.length + lastYearData.length;
            let confidenceLevel: 'high' | 'medium' | 'low';
            let dataQualityWarning: string | undefined;

            if (hasEnoughYoYData && recentData.length >= 28) {
                confidenceLevel = 'high';
            } else if (recentData.length >= 14) {
                confidenceLevel = 'medium';
                if (!hasEnoughYoYData) {
                    dataQualityWarning = 'Limited year-over-year data. Forecast is based on recent trends only.';
                }
            } else {
                confidenceLevel = 'low';
                dataQualityWarning = `Insufficient historical data (${recentData.length} days). Predictions may be inaccurate. We recommend at least 30 days of sales data for reliable forecasts.`;
                Logger.warn('[SalesForecast] Low confidence forecast due to insufficient data', {
                    accountId,
                    recentDataDays: recentData.length,
                    yoyDataDays: forecastDaysWithData
                });
            }

            // === Calculate Growth Factor ===
            // Compare last 30 days this year vs same 30 days last year
            let recentTotal = 0;
            let lastYearEquivalentTotal = 0;

            for (let i = 1; i <= 30; i++) {
                const thisYearDate = new Date(today);
                thisYearDate.setDate(today.getDate() - i);
                const thisYearStr = toDateString(thisYearDate);
                recentTotal += recentDataMap.get(thisYearStr) || 0;

                const lastYearDate = new Date(thisYearDate);
                lastYearDate.setFullYear(thisYearDate.getFullYear() - 1);
                const lastYearStr = toDateString(lastYearDate);
                lastYearEquivalentTotal += lastYearDataMap.get(lastYearStr) || 0;
            }

            // Growth factor: how much are we up/down vs same period last year
            const growthFactor = lastYearEquivalentTotal > 0
                ? recentTotal / lastYearEquivalentTotal
                : 1;

            // Calculate recent daily average for fallback
            const recentDailyAverage = recentData.length > 0
                ? recentTotal / Math.min(30, recentData.length)
                : 0;

            // === Generate Forecast ===
            const forecast = [];

            for (let i = 1; i <= daysToForecast; i++) {
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + i);
                const targetDateStr = toDateString(targetDate);

                // Find last year's equivalent date
                const lastYearEquivalent = new Date(targetDate);
                lastYearEquivalent.setFullYear(targetDate.getFullYear() - 1);
                const lastYearEquivalentStr = toDateString(lastYearEquivalent);

                let predictedSales: number;

                if (hasEnoughYoYData && lastYearDataMap.has(lastYearEquivalentStr)) {
                    // Primary method: Last year's value * growth factor
                    const lastYearSales = lastYearDataMap.get(lastYearEquivalentStr) || 0;
                    predictedSales = lastYearSales * growthFactor;
                } else {
                    // Fallback: Use recent daily average with slight decay for uncertainty
                    // Apply a small random variation (±5%) to avoid flat lines
                    const uncertaintyFactor = 0.95 + (Math.random() * 0.1);
                    predictedSales = recentDailyAverage * uncertaintyFactor;
                }

                forecast.push({
                    date: targetDateStr,
                    sales: Math.max(0, Math.round(predictedSales * 100) / 100),
                    isForecast: true
                });
            }

            // If we have no reasonable forecast, fall back to linear regression
            if (forecast.every(f => f.sales === 0) && recentData.length > 7) {
                return this.getLinearForecast(accountId, daysToForecast);
            }

            // Return forecast with confidence metadata
            return {
                forecast,
                confidence: confidenceLevel,
                warning: dataQualityWarning,
                metadata: {
                    recentDataDays: recentData.length,
                    yoyDataDays: forecastDaysWithData,
                    growthFactor: Math.round(growthFactor * 100) / 100
                }
            };

        } catch (error) {
            Logger.error('Analytics Forecast Error', { error });
            return this.getLinearForecast(accountId, daysToForecast);
        }
    }

    /**
     * Linear Regression Forecast
     * Fallback method using simple linear regression on last 90 days of data.
     */
    static async getLinearForecast(accountId: string, daysToForecast: number) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);

        const historicalData = await SalesAnalytics.getSalesOverTime(
            accountId,
            startDate.toISOString(),
            endDate.toISOString(),
            'day'
        );

        if (historicalData.length === 0) {
            return [];
        }

        // Single data point - project forward with no trend
        if (historicalData.length === 1) {
            const val = historicalData[0].sales;
            const lastDate = new Date(historicalData[0].date);
            return Array.from({ length: daysToForecast }, (_: unknown, i: number) => {
                const nextDate = new Date(lastDate);
                nextDate.setDate(nextDate.getDate() + i + 1);
                return {
                    date: nextDate.toISOString().split('T')[0],
                    sales: val,
                    isForecast: true
                };
            });
        }

        // Linear Regression: y = mx + c
        const x: number[] = historicalData.map((_: any, i: number) => i);
        const y: number[] = historicalData.map((p: any) => p.sales);
        const n = x.length;

        const sumX = x.reduce((a: number, b: number) => a + b, 0);
        const sumY = y.reduce((a: number, b: number) => a + b, 0);
        const sumXY = x.reduce((acc: number, curr: number, i: number) => acc + curr * y[i], 0);
        const sumXX = x.reduce((acc: number, curr: number) => acc + curr * curr, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Generate forecast
        const lastDate = new Date(historicalData[historicalData.length - 1].date);
        return Array.from({ length: daysToForecast }, (_: unknown, i: number) => {
            const nextIndex = n + i;
            const predictedSales = slope * nextIndex + intercept;
            const nextDate = new Date(lastDate);
            nextDate.setDate(nextDate.getDate() + i + 1);

            return {
                date: nextDate.toISOString().split('T')[0],
                sales: Math.max(0, predictedSales),
                isForecast: true
            };
        });
    }
}
