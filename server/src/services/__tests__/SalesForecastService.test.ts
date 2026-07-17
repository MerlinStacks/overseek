import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analytics/sales', () => ({
    SalesAnalytics: {
        getSalesOverTime: vi.fn()
    }
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        error: vi.fn(),
        warn: vi.fn()
    }
}));

import { SalesForecastService } from '../analytics/SalesForecast';
import { SalesAnalytics } from '../analytics/sales';

const getSalesOverTime = vi.mocked(SalesAnalytics.getSalesOverTime);

function dateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function daysBeforeToday(days: number): Date {
    const date = new Date('2026-07-17T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() - days);
    return date;
}

function dailySeries(days: number, sales: (daysAgo: number) => number) {
    return Array.from({ length: days }, (_, index) => {
        const daysAgo = days - index;
        return {
            date: dateString(daysBeforeToday(daysAgo)),
            sales: sales(daysAgo),
            orders: 1
        };
    });
}

function priorYearSeries(days: number, sales: number) {
    const start = new Date('2025-04-18T00:00:00.000Z');
    return Array.from({ length: days }, (_, index) => {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + index);
        return { date: dateString(date), sales, orders: 1 };
    });
}

describe('SalesForecastService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
    });

    it('returns a deterministic ensemble forecast with prediction ranges', async () => {
        const recent = dailySeries(90, daysAgo => 200 + (daysAgo % 7) * 10);
        const yearly = priorYearSeries(121, 100);
        getSalesOverTime.mockResolvedValueOnce(recent).mockResolvedValueOnce(yearly);

        const first = await SalesForecastService.getSalesForecast('account-1', 30);

        getSalesOverTime.mockResolvedValueOnce(recent).mockResolvedValueOnce(yearly);
        const second = await SalesForecastService.getSalesForecast('account-1', 30);

        expect(first).toEqual(second);
        expect(first.forecast).toHaveLength(30);
        expect(first.metadata.method).toBe('weekday-ewma-yoy-ensemble');
        expect(first.metadata.growthFactor).toBe(2);
        expect(first.metadata.backtestAccuracy).not.toBeNull();
        expect(first.forecast.every(point => point.lower <= point.sales && point.upper >= point.sales)).toBe(true);
    });

    it('includes zero-sale calendar days when forecasting sparse history', async () => {
        const sparseRecent = dailySeries(90, () => 700).filter((_, index) => index % 14 === 0);
        getSalesOverTime.mockResolvedValueOnce(sparseRecent).mockResolvedValueOnce([]);

        const result = await SalesForecastService.getSalesForecast('account-1', 7);

        expect(result.confidence).toBe('low');
        expect(result.metadata.activeHistoryDays).toBe(7);
        expect(result.metadata.growthFactor).toBeNull();
        expect(result.forecast.every(point => point.sales < 700)).toBe(true);
        expect(result.warning).toContain('Limited prior-year history');
    });

    it('returns a stable zero forecast response when there is no sales history', async () => {
        getSalesOverTime.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        const result = await SalesForecastService.getSalesForecast('account-1', 5);

        expect(result.forecast).toHaveLength(5);
        expect(result.forecast.every(point => point.sales === 0 && point.lower === 0 && point.upper === 0)).toBe(true);
        expect(result.confidence).toBe('low');
        expect(result.warning).toContain('No sales were found');
    });

    it('caps the requested horizon at 365 days', async () => {
        getSalesOverTime.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        const result = await SalesForecastService.getSalesForecast('account-1', 1000);

        expect(result.forecast).toHaveLength(365);
    });
});
