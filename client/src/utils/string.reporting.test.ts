import { expect, it } from 'vitest';
import { escapeRegex, getInitials } from './string';
import { reportingWindow } from './reportingWindow';
it.each([null, undefined, 12, [], {}, { firstName: 42 }])('safely handles malformed initials %j', value => expect(getInitials(value)).toBe('?'));
it('preserves graphemes and handles valid object/full-name input', () => {
    expect(getInitials('John Doe')).toBe('JD'); expect(getInitials({ firstName: ' Zoë ', lastName: 'Smith' })).toBe('ZS');
    expect(getInitials('😀 Example')).toBe('😀E'); expect(getInitials('e\u0301 Example')).toBe('E\u0301E');
});
it('escapes literal regex syntax and rejects nonstrings', () => {
    const value = 'a[b].*+?${}()|\\^'; expect(new RegExp(`^${escapeRegex(value)}$`).test(value)).toBe(true); expect(() => escapeRegex({})).toThrow(TypeError);
});
it('resolves one account calendar window across DST changes', () => {
    const range = reportingWindow(1, 'America/New_York', new Date('2026-03-08T16:00:00Z'));
    expect(range.startDate).toBe('2026-03-08T05:00:00.000Z'); expect(range.endDate).toBe('2026-03-09T03:59:59.999Z');
    const yesterday = reportingWindow(-1, 'Australia/Sydney', new Date('2026-10-21T15:00:00Z'));
    expect(yesterday.startDate).toBe('2026-10-20T13:00:00.000Z'); expect(yesterday.endDate).toBe('2026-10-21T12:59:59.999Z');
    expect(() => reportingWindow(1, 'invalid')).toThrow(); expect(reportingWindow(1, undefined).timezoneUnavailable).toBe(true);
});
