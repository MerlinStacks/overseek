import { Logger } from '../../utils/logger';
import { SalesAnalytics } from './sales';

interface SalesPoint {
    date: string;
    sales: number;
}

interface ForecastPoint extends SalesPoint {
    lower: number;
    upper: number;
    isForecast: true;
}

const HISTORY_DAYS = 90;
const BACKTEST_DAYS = 14;

function toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function previousYear(date: Date): Date {
    const year = date.getUTCFullYear() - 1;
    const month = date.getUTCMonth();
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDayOfMonth)));
}

function roundCurrency(value: number): number {
    return Math.round(Math.max(0, value) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function denseDailySeries(start: Date, days: number, values: Map<string, number>): SalesPoint[] {
    return Array.from({ length: days }, (_, index) => {
        const date = addDays(start, index);
        return {
            date: toDateString(date),
            sales: values.get(toDateString(date)) ?? 0
        };
    });
}

function mean(values: number[]): number {
    return values.length > 0
        ? values.reduce((total, value) => total + value, 0) / values.length
        : 0;
}

function exponentiallyWeightedMean(values: number[], alpha = 0.15): number {
    if (values.length === 0) return 0;

    let weightedTotal = 0;
    let totalWeight = 0;
    values.forEach((value, index) => {
        const weight = Math.pow(1 - alpha, values.length - index - 1);
        weightedTotal += value * weight;
        totalWeight += weight;
    });

    return totalWeight > 0 ? weightedTotal / totalWeight : 0;
}

function calculateGrowthFactor(history: SalesPoint[], yearlyData: Map<string, number>): number | null {
    const recent = history.slice(-28);
    const recentTotal = recent.reduce((total, point) => total + point.sales, 0);
    const priorTotal = recent.reduce((total, point) => {
        const priorDate = previousYear(new Date(`${point.date}T00:00:00.000Z`));
        return total + (yearlyData.get(toDateString(priorDate)) ?? 0);
    }, 0);

    if (priorTotal <= 0) return null;
    return clamp(recentTotal / priorTotal, 0.5, 2);
}

function predictSales(
    targetDate: Date,
    history: SalesPoint[],
    yearlyData: Map<string, number>,
    growthFactor: number | null,
    useYearlyModel: boolean
): number {
    const weekdayValues = history
        .filter(point => new Date(`${point.date}T00:00:00.000Z`).getUTCDay() === targetDate.getUTCDay())
        .slice(-8)
        .map(point => point.sales);
    const recentValues = history.slice(-28).map(point => point.sales);
    const components = [
        { value: mean(weekdayValues), weight: 0.4 },
        { value: exponentiallyWeightedMean(recentValues), weight: 0.3 }
    ];

    if (useYearlyModel && growthFactor !== null) {
        const priorDate = previousYear(targetDate);
        components.push({
            value: (yearlyData.get(toDateString(priorDate)) ?? 0) * growthFactor,
            weight: 0.3
        });
    }

    const totalWeight = components.reduce((total, component) => total + component.weight, 0);
    return components.reduce((total, component) => total + component.value * component.weight, 0) / totalWeight;
}

function backtest(history: SalesPoint[], yearlyData: Map<string, number>, useYearlyModel: boolean) {
    const errors: number[] = [];
    let actualTotal = 0;

    for (let index = history.length - BACKTEST_DAYS; index < history.length; index++) {
        const training = history.slice(0, index);
        const target = history[index];
        const targetDate = new Date(`${target.date}T00:00:00.000Z`);
        const growthFactor = calculateGrowthFactor(training, yearlyData);
        const prediction = predictSales(targetDate, training, yearlyData, growthFactor, useYearlyModel);
        errors.push(Math.abs(target.sales - prediction));
        actualTotal += target.sales;
    }

    const absoluteError = errors.reduce((total, error) => total + error, 0);
    const wape = actualTotal > 0 ? absoluteError / actualTotal : null;
    const sortedErrors = [...errors].sort((a, b) => a - b);
    const percentileIndex = Math.max(0, Math.ceil(sortedErrors.length * 0.8) - 1);

    return {
        wape,
        accuracy: wape === null ? null : clamp(1 - wape, 0, 1),
        intervalError: sortedErrors[percentileIndex] ?? 0
    };
}

export class SalesForecastService {
    static async getSalesForecast(accountId: string, daysToForecast: number = 30) {
        const horizon = Math.min(Math.max(Math.trunc(daysToForecast), 1), 365);

        try {
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            const historyStart = addDays(today, -HISTORY_DAYS);
            const historyEnd = addDays(today, -1);
            const yearlyStart = previousYear(historyStart);
            const yearlyEnd = previousYear(addDays(today, horizon));

            const [recentData, yearlyRawData] = await Promise.all([
                SalesAnalytics.getSalesOverTime(
                    accountId,
                    historyStart.toISOString(),
                    `${toDateString(historyEnd)}T23:59:59.999Z`,
                    'day'
                ),
                SalesAnalytics.getSalesOverTime(
                    accountId,
                    yearlyStart.toISOString(),
                    `${toDateString(yearlyEnd)}T23:59:59.999Z`,
                    'day'
                )
            ]);

            const recentMap = new Map<string, number>(
                recentData.map(point => [point.date, Number(point.sales) || 0])
            );
            const yearlyData = new Map<string, number>(
                yearlyRawData.map(point => [point.date, Number(point.sales) || 0])
            );
            const history = denseDailySeries(historyStart, HISTORY_DAYS, recentMap);
            const activeHistoryDays = recentData.filter(point => Number(point.sales) > 0).length;
            const priorHistoryActiveDays = history.filter(point => {
                const priorDate = previousYear(new Date(`${point.date}T00:00:00.000Z`));
                return (yearlyData.get(toDateString(priorDate)) ?? 0) > 0;
            }).length;
            const growthFactor = calculateGrowthFactor(history, yearlyData);
            const useYearlyModel = priorHistoryActiveDays >= 7 && growthFactor !== null;
            const validation = backtest(history, yearlyData, useYearlyModel);

            let confidence: 'high' | 'medium' | 'low' = 'low';
            if (validation.wape !== null && validation.wape <= 0.25 && useYearlyModel && activeHistoryDays >= 28) {
                confidence = 'high';
            } else if (validation.wape !== null && validation.wape <= 0.5 && activeHistoryDays >= 14) {
                confidence = 'medium';
            }

            let warning: string | undefined;
            if (activeHistoryDays === 0) {
                warning = 'No sales were found in the last 90 days. The forecast will remain at zero until sales history is available.';
            } else if (!useYearlyModel) {
                warning = 'Limited prior-year history. This forecast uses recent weekday patterns and weighted recent sales.';
            } else if (confidence === 'low') {
                warning = 'Recent backtesting shows high forecast error. Use the estimated range when planning.';
            }

            const forecast: ForecastPoint[] = Array.from({ length: horizon }, (_, index) => {
                const targetDate = addDays(today, index + 1);
                const predictedSales = predictSales(targetDate, history, yearlyData, growthFactor, useYearlyModel);
                const horizonScale = 1 + (index / Math.max(horizon, 1)) * 0.5;
                const interval = validation.intervalError * horizonScale;

                return {
                    date: toDateString(targetDate),
                    sales: roundCurrency(predictedSales),
                    lower: roundCurrency(predictedSales - interval),
                    upper: roundCurrency(predictedSales + interval),
                    isForecast: true
                };
            });

            return {
                forecast,
                confidence,
                warning,
                metadata: {
                    method: useYearlyModel ? 'weekday-ewma-yoy-ensemble' : 'weekday-ewma-ensemble',
                    historyDays: HISTORY_DAYS,
                    activeHistoryDays,
                    yoyDataDays: priorHistoryActiveDays,
                    growthFactor: growthFactor === null ? null : Math.round(growthFactor * 100) / 100,
                    backtestAccuracy: validation.accuracy === null
                        ? null
                        : Math.round(validation.accuracy * 100),
                    backtestWape: validation.wape === null
                        ? null
                        : Math.round(validation.wape * 1000) / 1000,
                    dataThrough: toDateString(historyEnd)
                }
            };
        } catch (error) {
            Logger.error('Analytics Forecast Error', { error });
            return {
                forecast: [],
                confidence: 'low' as const,
                warning: 'Sales forecast data is temporarily unavailable.',
                metadata: {
                    method: 'unavailable',
                    historyDays: 0,
                    activeHistoryDays: 0,
                    yoyDataDays: 0,
                    growthFactor: null,
                    backtestAccuracy: null,
                    backtestWape: null,
                    dataThrough: null
                }
            };
        }
    }
}
