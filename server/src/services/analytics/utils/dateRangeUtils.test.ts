import { describe, expect, it } from 'vitest';
import { calculatePercentChange, formatDateRange, getWeekStart, monthsDifference, resolvePeriodWithComparison } from './dateRangeUtils';
const now = new Date('2026-05-15T12:30:00Z');
describe('analytics date ranges', () => {
    it.each([['7d', 7], ['30d', 30], ['90d', 90]] as const)('creates non-overlapping equal-duration rolling windows for %s', (period, days) => {
        const range = resolvePeriodWithComparison(period, { now });
        expect(range.end).toEqual(now);
        expect(range.start.getTime()).toBe(now.getTime() - days * 86400000);
        expect(range.prevEnd.getTime()).toBe(range.start.getTime() - 1);
        expect(range.prevEnd.getTime() - range.prevStart.getTime()).toBe(range.end.getTime() - range.start.getTime());
    });
    it('resolves yesterday in the account timezone, including a 23-hour DST day', () => {
        const range = resolvePeriodWithComparison('1d', { now: new Date('2026-03-09T16:00:00Z'), timezone: 'America/New_York' });
        expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
        expect(range.end.toISOString()).toBe('2026-03-09T03:59:59.999Z');
        expect(range.prevEnd.getTime()).toBe(range.start.getTime() - 1);
        expect(range.prevStart.toISOString()).toBe('2026-03-07T05:00:00.000Z');
    });
    it('preserves local clock times across DST in rolling ranges', () => {
        const range = resolvePeriodWithComparison('7d', { now: new Date('2026-03-09T16:00:00Z'), timezone: 'America/New_York' });
        expect(range.start.toISOString()).toBe('2026-03-02T17:00:00.000Z');
        expect(range.prevEnd.getTime()).toBeLessThan(range.start.getTime());
    });
    it('clamps February 29 to February 28 for the previous YTD', () => {
        const range = resolvePeriodWithComparison('ytd', { now: new Date('2024-02-29T12:30:00Z') });
        expect(range.prevEnd.toISOString()).toBe('2023-02-28T12:30:00.000Z');
        expect(range.prevStart.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    });
    it('uses account-local years at a UTC year boundary', () => {
        const range = resolvePeriodWithComparison('ytd', { now: new Date('2025-12-31T16:00:00Z'), timezone: 'Australia/Sydney' });
        expect(range.start.toISOString()).toBe('2025-12-31T13:00:00.000Z');
        expect(range.prevStart.toISOString()).toBe('2024-12-31T13:00:00.000Z');
    });
    it('supports explicit custom ranges without mutating caller dates', () => {
        const customRange = { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-05T23:59:59.999Z') };
        const result = resolvePeriodWithComparison('custom', { now, customRange });
        expect(result.start).toEqual(customRange.start);
        expect(result.start).not.toBe(customRange.start);
        expect(result.prevEnd.toISOString()).toBe('2025-12-31T23:59:59.999Z');
        expect(result.prevStart.toISOString()).toBe('2025-12-27T00:00:00.000Z');
        expect(now.toISOString()).toBe('2026-05-15T12:30:00.000Z');
    });
    it('rejects missing custom bounds, reversed ranges and invalid dates', () => {
        expect(() => resolvePeriodWithComparison('custom', { now })).toThrow('requires a date range');
        expect(() => resolvePeriodWithComparison('custom', { customRange: { start: now, end: new Date(0) } })).toThrow('Invalid date range');
        expect(() => resolvePeriodWithComparison('7d', { now: new Date(NaN) })).toThrow('Invalid current date');
    });
    it('resolves Monday starts and month differences in the selected timezone', () => {
        expect(getWeekStart(new Date('2026-01-04T16:00:00Z'), 'Australia/Sydney').toISOString()).toBe('2026-01-04T13:00:00.000Z');
        expect(monthsDifference(new Date('2026-01-31T12:00:00Z'), new Date('2026-01-31T14:00:00Z'), 'Australia/Sydney')).toBe(1);
    });
    it('formats dates in the selected timezone', () => {
        expect(formatDateRange({ start: new Date('2025-12-31T16:00:00Z'), end: new Date('2026-01-01T16:00:00Z') }, 'Australia/Sydney')).toBe('Jan 1 - Jan 2');
    });
    it.each([[0, 0, 0], [0, 10, 100], [100, 125, 25], [100, 50, -50], [Infinity, 10, 0], [10, NaN, 0]])('keeps percent change finite for %s -> %s', (previous, current, expected) => {
        expect(calculatePercentChange(previous, current)).toBe(expected);
    });
});
