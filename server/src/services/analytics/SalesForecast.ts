/**
 * Sales Forecasting Service
 * 
 * Extracted from SalesAnalytics for modularity.
 * Provides seasonality-aware and linear regression-based sales forecasting.
 */

import { Logger } from '../../utils/logger';
import { SalesAnalytics } from './sales';

export class SalesForecastService {

    /**
     * Get Sales Forecast (Seasonality & YoY Growth Aware)
     * Primary forecasting method - uses year-over-year comparison with growth adjustment.
     * Falls back to linear regression if insufficient historical data.
     */
    static async getSalesForecast(accountId: string, daysToForecast: number = 30) {
        try {
            const now = new Date();
            const lastYearStart = new Date(now);
            lastYearStart.setFullYear(now.getFullYear() - 1);
            lastYearStart.setDate(lastYearStart.getDate() - 30);

            const lastYearEnd = new Date(now);
            lastYearEnd.setFullYear(now.getFullYear() - 1);
            lastYearEnd.setDate(lastYearEnd.getDate() + daysToForecast);

            // Fetch Last Year's Data
            const historicalData = await SalesAnalytics.getSalesOverTime(
                accountId,
                lastYearStart.toISOString(),
                lastYearEnd.toISOString(),
                'day'
            );

            // Fetch Recent Data (Last 30 Days) for Growth Calculation
            const recentStart = new Date();
            recentStart.setDate(recentStart.getDate() - 30);
            const recentData = await SalesAnalytics.getSalesOverTime(
                accountId,
                recentStart.toISOString(),
                now.toISOString(),
                'day'
            );

            // Fallback to Linear Regression if insufficient historical data
            if (historicalData.length < 30) {
                return this.getLinearForecast(accountId, daysToForecast);
            }

            // Calculate Growth Factor
            const recentTotal = recentData.reduce((sum: number, d: any) => sum + d.sales, 0);
            const samePeriodLastYear = historicalData.filter(
                (d: any) => new Date(d.date) < new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
            );
            const lastYearTotal = samePeriodLastYear.reduce((sum: number, d: any) => sum + d.sales, 0);
            const growthFactor = lastYearTotal > 0 ? recentTotal / lastYearTotal : 1;

            // Generate Forecast using last year's future data with growth adjustment
            const futureLastYear = historicalData.filter(
                (d: any) => new Date(d.date) >= new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
            );

            const forecast = [];
            for (let i = 0; i < daysToForecast; i++) {
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() + i + 1);

                const matchDateLastYear = new Date(targetDate);
                matchDateLastYear.setFullYear(targetDate.getFullYear() - 1);
                const matchStr = matchDateLastYear.toISOString().split('T')[0];

                const baselineDay = futureLastYear.find((d: any) => d.date === matchStr) || { sales: 0 };

                forecast.push({
                    date: targetDate.toISOString().split('T')[0],
                    sales: Math.max(0, baselineDay.sales * growthFactor),
                    isForecast: true
                });
            }

            return forecast;

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
