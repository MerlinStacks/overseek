import { beforeEach, describe, expect, it } from 'vitest';
import { formatDate, formatTime, formatDateTime, formatDateSafe } from './format';

describe('personal date and time formatting', () => {
    beforeEach(() => localStorage.clear());
    it('applies stored date order, timezone rollover and 24-hour time', () => {
        localStorage.setItem('user', JSON.stringify({ timezone: 'America/New_York', dateFormat: 'ymd', timeFormat: '24h' }));
        expect(formatDate('2026-01-02T01:30:00Z')).toBe('2026-01-01');
        expect(formatTime('2026-01-02T01:30:00Z')).toBe('20:30');
        expect(formatDateTime('2026-01-02T01:30:00Z')).toBe('2026-01-01, 20:30');
    });
    it.each([['dmy', '02/01/2026'], ['mdy', '01/02/2026'], ['ymd', '2026-01-02']])('supports %s without shifting calendar-only dates', (dateFormat, expected) => {
        localStorage.setItem('user', JSON.stringify({ timezone: 'America/Los_Angeles', dateFormat }));
        expect(formatDate('2026-01-02')).toBe(expected);
        expect(formatDateSafe('2026-01-02')).toBe(expected);
    });
    it('observes daylight saving time', () => {
        localStorage.setItem('user', JSON.stringify({ timezone: 'Australia/Sydney', timeFormat: '24h' }));
        expect(formatTime('2026-01-01T12:00:00Z')).toBe('23:00');
        expect(formatTime('2026-07-01T12:00:00Z')).toBe('22:00');
    });
    it('uses 12-hour time and reads preference changes without reloading', () => {
        localStorage.setItem('user', JSON.stringify({ timezone: 'UTC', timeFormat: '12h' }));
        expect(formatTime('2026-01-01T15:30:00Z')).toBe('3:30 pm');
        localStorage.setItem('user', JSON.stringify({ timezone: 'UTC', timeFormat: '24h' }));
        expect(formatTime('2026-01-01T15:30:00Z')).toBe('15:30');
    });
    it('preserves defaults and invalid-date fallbacks', () => {
        expect(formatDate('2026-01-02T12:00:00Z')).toBe(new Date('2026-01-02T12:00:00Z').toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }));
        expect(formatDate('invalid')).toBe('-');
        expect(formatTime('invalid')).toBe('');
        expect(formatDateSafe(null, 'Unavailable')).toBe('Unavailable');
    });
});
