import { describe, expect, it } from 'vitest';
import { getDateRangeForDays } from './dateRange';

describe('tracking date ranges', () => {
    it('uses local midnight for today', () => {
        const now = new Date('2026-10-16T04:00:00Z');
        expect(getDateRangeForDays(1, 'Australia/Sydney', now)).toEqual({
            startDate: new Date('2026-10-15T13:00:00Z'), endDate: now
        });
    });

    it('uses only the previous local day for yesterday', () => {
        expect(getDateRangeForDays(-1, 'Australia/Sydney', new Date('2026-10-16T04:00:00Z'))).toEqual({
            startDate: new Date('2026-10-14T13:00:00Z'),
            endDate: new Date('2026-10-15T12:59:59.999Z')
        });
    });

    it.each([7, 30, 90, 365])('preserves the rolling %i day window', days => {
        const now = new Date('2026-10-16T04:00:00Z');
        expect(getDateRangeForDays(days, 'Australia/Sydney', now)).toEqual({
            startDate: new Date(now.getTime() - days * 86400000), endDate: now
        });
    });

    it.each([
        ['2026-10-05T04:00:00Z', '2026-10-03T14:00:00Z', '2026-10-04T12:59:59.999Z'],
        ['2026-04-06T04:00:00Z', '2026-04-04T13:00:00Z', '2026-04-05T13:59:59.999Z'],
        ['2026-01-01T04:00:00Z', '2025-12-30T13:00:00Z', '2025-12-31T12:59:59.999Z']
    ])('handles daylight saving and year boundaries at %s', (now, start, end) => {
        expect(getDateRangeForDays(-1, 'Australia/Sydney', new Date(now))).toEqual({
            startDate: new Date(start), endDate: new Date(end)
        });
    });
});
