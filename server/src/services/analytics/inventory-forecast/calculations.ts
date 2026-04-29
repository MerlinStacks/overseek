import { calculateSeasonalityCoefficients } from '../utils/forecastUtils';
import type { ForecastCurvePoint } from './types';

export function calculateProductSeasonality(
    salesData: Map<number, Array<{ date: string; quantity: number }>>
): Map<number, Map<number, number>> {
    const result = new Map<number, Map<number, number>>();
    for (const [productId, sales] of salesData) {
        const monthlySales = new Map<number, number>();
        for (const { date, quantity } of sales) {
            const month = new Date(date).getMonth() + 1;
            monthlySales.set(month, (monthlySales.get(month) || 0) + quantity);
        }
        result.set(productId, calculateSeasonalityCoefficients(monthlySales));
    }
    return result;
}

export function aggregateToDailySales(
    sales: Array<{ date: string; quantity: number }>,
    days: number
): number[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const filtered = sales.filter(s => s.date >= cutoffStr).sort((a, b) => a.date.localeCompare(b.date));
    const dailyMap = new Map<string, number>();
    for (const { date, quantity } of filtered) {
        dailyMap.set(date, (dailyMap.get(date) || 0) + quantity);
    }

    const result: number[] = [];
    const current = new Date(cutoff);
    const today = new Date();
    while (current <= today) {
        result.push(dailyMap.get(current.toISOString().split('T')[0]) || 0);
        current.setDate(current.getDate() + 1);
    }
    return result;
}

export function aggregateToHistoricalDemand(
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

export function generateForecastCurve(
    currentStock: number,
    dailyDemand: number,
    confidence: number,
    days: number
): ForecastCurvePoint[] {
    const curve: ForecastCurvePoint[] = [];
    const bandWidth = (100 - confidence) / 100 * 0.5;

    for (let i = 0; i <= days; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        const predictedStock = Math.max(0, currentStock - dailyDemand * i);
        const variation = predictedStock * bandWidth * (i / days);

        curve.push({
            date: dateStr,
            predictedStock: Math.round(predictedStock),
            upperBound: Math.round(predictedStock + variation),
            lowerBound: Math.round(Math.max(0, predictedStock - variation))
        });
    }

    return curve;
}

export function sortByRisk<T extends { stockoutRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; daysUntilStockout: number }>(
    forecasts: T[]
): T[] {
    const riskOrder: Record<string, number> = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    return [...forecasts].sort((a, b) => {
        const diff = riskOrder[a.stockoutRisk] - riskOrder[b.stockoutRisk];
        if (diff !== 0) return diff;
        return a.daysUntilStockout - b.daysUntilStockout;
    });
}
