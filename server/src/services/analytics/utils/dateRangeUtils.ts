/**
 * Analytics Date Range Utilities
 * 
 * Shared utilities for date range calculations used across analytics services.
 * Centralizes period resolution to ensure consistency and reduce duplication.
 */

import { dateKeyInTimezone, normalizeTimezone, sameTimeOnDateInTimezone, startOfDateInTimezone } from '../../../utils/timezone';

export type PeriodOption = '1d' | '7d' | '30d' | '90d' | 'ytd' | 'custom';

export interface DateRange {
    start: Date;
    end: Date;
}

export interface DateRangeWithComparison extends DateRange {
    prevStart: Date;
    prevEnd: Date;
}

/**
 * Resolves a period string to a date range with comparison period
 */
export function resolvePeriodWithComparison(period: PeriodOption, options: {
    timezone?: string;
    now?: Date;
    customRange?: DateRange;
} = {}): DateRangeWithComparison {
    const now = new Date(options.now ?? new Date());
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid current date');
    const timezone = normalizeTimezone(options.timezone);
    const today = dateKeyInTimezone(now, timezone);

    if (period === '1d') {
        const start = startOfDateInTimezone(shiftDate(today, -1), timezone);
        return {
            start, end: new Date(startOfDateInTimezone(today, timezone).getTime() - 1),
            prevStart: startOfDateInTimezone(shiftDate(today, -2), timezone),
            prevEnd: new Date(start.getTime() - 1),
        };
    }
    if (period === 'ytd') {
        const [year, month, day] = today.split('-').map(Number);
        const priorDay = Math.min(day, new Date(Date.UTC(year - 1, month, 0)).getUTCDate());
        const previousDate = `${year - 1}-${String(month).padStart(2, '0')}-${String(priorDay).padStart(2, '0')}`;
        return {
            start: startOfDateInTimezone(`${year}-01-01`, timezone), end: now,
            prevStart: startOfDateInTimezone(`${year - 1}-01-01`, timezone),
            prevEnd: sameTimeOnDateInTimezone(now, previousDate, timezone),
        };
    }
    let start: Date;
    let end = now;
    if (period === 'custom') {
        if (!options.customRange) throw new Error('Custom period requires a date range');
        start = new Date(options.customRange.start);
        end = new Date(options.customRange.end);
    } else {
        const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
        if (!days) throw new Error('Unsupported period');
        // Rolling store-local days; comparison has the same elapsed duration and no overlap.
        start = sameTimeOnDateInTimezone(now, shiftDate(today, -days), timezone);
    }
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw new Error('Invalid date range');
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - (end.getTime() - start.getTime()));
    if (!Number.isFinite(prevStart.getTime())) throw new Error('Comparison date range is out of bounds');
    return { start, end, prevStart, prevEnd };
}

function shiftDate(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/**
 * Calculate the difference in months between two dates
 */
export function monthsDifference(date1: Date, date2: Date, timezone = 'UTC'): number {
    const [year1, month1] = dateKeyInTimezone(date1, timezone).split('-').map(Number);
    const [year2, month2] = dateKeyInTimezone(date2, timezone).split('-').map(Number);
    return (year2 - year1) * 12 + month2 - month1;
}

/**
 * Get the start of a week (Monday) for a given date
 */
export function getWeekStart(date: Date, timezone = 'UTC'): Date {
    const dateKey = dateKeyInTimezone(date, timezone);
    const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    return startOfDateInTimezone(shiftDate(dateKey, -(day === 0 ? 6 : day - 1)), timezone);
}

/**
 * Calculate percentage change between two values
 * Returns 0 if both values are 0, 100 if only current > 0
 */
export function calculatePercentChange(previous: number, current: number): number {
    if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
    if (previous === 0) return current > 0 ? 100 : 0;
    const change = Math.round(((current - previous) / previous) * 100);
    return Number.isFinite(change) ? change : 0;
}

/**
 * Format a date range as a human-readable string
 */
export function formatDateRange(range: DateRange, timezone = 'UTC'): string {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: normalizeTimezone(timezone) };
    return `${range.start.toLocaleDateString('en-US', options)} - ${range.end.toLocaleDateString('en-US', options)}`;
}
