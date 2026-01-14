/**
 * Analytics Date Range Utilities
 * 
 * Shared utilities for date range calculations used across analytics services.
 * Centralizes period resolution to ensure consistency and reduce duplication.
 */

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
export function resolvePeriodWithComparison(period: PeriodOption): DateRangeWithComparison {
    const now = new Date();
    const end = new Date(now);
    const start = new Date(now);
    const prevEnd = new Date(now);
    const prevStart = new Date(now);

    switch (period) {
        case '1d':
            // Yesterday
            start.setDate(start.getDate() - 1);
            start.setHours(0, 0, 0, 0);
            end.setDate(end.getDate() - 1);
            end.setHours(23, 59, 59, 999);
            // Day before yesterday
            prevStart.setDate(prevStart.getDate() - 2);
            prevStart.setHours(0, 0, 0, 0);
            prevEnd.setDate(prevEnd.getDate() - 2);
            prevEnd.setHours(23, 59, 59, 999);
            break;

        case '7d':
            start.setDate(start.getDate() - 7);
            start.setHours(0, 0, 0, 0);
            prevEnd.setDate(prevEnd.getDate() - 7);
            prevEnd.setHours(23, 59, 59, 999);
            prevStart.setDate(prevStart.getDate() - 14);
            prevStart.setHours(0, 0, 0, 0);
            break;

        case '30d':
            start.setDate(start.getDate() - 30);
            start.setHours(0, 0, 0, 0);
            prevEnd.setDate(prevEnd.getDate() - 30);
            prevEnd.setHours(23, 59, 59, 999);
            prevStart.setDate(prevStart.getDate() - 60);
            prevStart.setHours(0, 0, 0, 0);
            break;

        case '90d':
            start.setDate(start.getDate() - 90);
            start.setHours(0, 0, 0, 0);
            prevEnd.setDate(prevEnd.getDate() - 90);
            prevEnd.setHours(23, 59, 59, 999);
            prevStart.setDate(prevStart.getDate() - 180);
            prevStart.setHours(0, 0, 0, 0);
            break;

        case 'ytd':
            start.setMonth(0, 1);
            start.setHours(0, 0, 0, 0);
            // Previous YTD: same period last year
            prevEnd.setFullYear(prevEnd.getFullYear() - 1);
            prevStart.setFullYear(prevStart.getFullYear() - 1);
            prevStart.setMonth(0, 1);
            prevStart.setHours(0, 0, 0, 0);
            break;

        default:
            // Default to 30d
            start.setDate(start.getDate() - 30);
            start.setHours(0, 0, 0, 0);
            prevEnd.setDate(prevEnd.getDate() - 30);
            prevStart.setDate(prevStart.getDate() - 60);
    }

    return { start, end, prevStart, prevEnd };
}

/**
 * Calculate the difference in months between two dates
 */
export function monthsDifference(date1: Date, date2: Date): number {
    return (date2.getFullYear() - date1.getFullYear()) * 12 + (date2.getMonth() - date1.getMonth());
}

/**
 * Get the start of a week (Monday) for a given date
 */
export function getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Calculate percentage change between two values
 * Returns 0 if both values are 0, 100 if only current > 0
 */
export function calculatePercentChange(previous: number, current: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
}

/**
 * Format a date range as a human-readable string
 */
export function formatDateRange(range: DateRange): string {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${range.start.toLocaleDateString('en-US', options)} - ${range.end.toLocaleDateString('en-US', options)}`;
}
