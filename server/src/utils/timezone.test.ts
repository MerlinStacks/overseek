import { describe, expect, it } from 'vitest';
import { sameTimeOnDateInTimezone, startOfDateInTimezone } from './timezone';
describe('store-local calendar windows', () => {
    it.each([
        ['2026-03-08', 'America/New_York', '2026-03-08T05:00:00.000Z'],
        ['2026-03-09', 'America/New_York', '2026-03-09T04:00:00.000Z'],
        ['2026-01-01', 'Australia/Sydney', '2025-12-31T13:00:00.000Z'],
        ['2026-01-01', 'invalid', '2026-01-01T00:00:00.000Z'],
    ])('preserves midnight conversion for %s in %s', (day, timezone, expected) => {
        expect(startOfDateInTimezone(day, timezone).toISOString()).toBe(expected);
    });
    it.each([
        ['2026-03-09T06:30:00Z', '2026-03-08', 'America/New_York', '2026-03-08T07:30:00.000Z'],
        ['2026-03-30T00:30:00Z', '2026-03-29', 'Europe/Berlin', '2026-03-29T01:30:00.000Z'],
    ])('moves nonexistent DST times forward for %s on %s in %s', (reference, day, timezone, expected) => {
        expect(sameTimeOnDateInTimezone(new Date(reference), day, timezone).toISOString()).toBe(expected);
    });
    it('preserves seconds and milliseconds in historical wall times', () => {
        expect(sameTimeOnDateInTimezone(new Date('2026-03-09T16:30:15.123Z'), '2026-03-07', 'America/New_York').toISOString())
            .toBe('2026-03-07T17:30:15.123Z');
    });
});
