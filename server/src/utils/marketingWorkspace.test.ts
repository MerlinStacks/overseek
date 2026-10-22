import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMarketingSchedule } from './marketingSchedule';
import { campaignSubjectVariant, marketingPressureConfig } from './marketingExperiment';
import { assertBroadcastReady } from './marketingReadiness';

afterEach(() => vi.unstubAllEnvs());
describe('explicit marketing schedule', () => {
    it('converts a chosen IANA wall time to the exact UTC instant', () => {
        expect(resolveMarketingSchedule('2026-10-22T09:30', 'Australia/Sydney').toISOString()).toBe('2026-10-21T22:30:00.000Z');
        expect(resolveMarketingSchedule('2026-10-22T09:30', 'UTC').toISOString()).toBe('2026-10-22T09:30:00.000Z');
    });
    it.each([['2026-03-08T02:30', 'America/New_York'], ['2026-11-01T01:30', 'America/New_York'], ['2026-02-30T10:00', 'UTC'], ['2026-10-22T10:00', 'not-a-zone'], ['nope', 'UTC']])('rejects ambiguous, nonexistent or invalid times (%s)', (value, zone) => {
        expect(() => resolveMarketingSchedule(value, zone)).toThrow();
    });
});
describe('subject experiments', () => {
    it('pins assignments across normalized emails and repeated runs', () => {
        expect(campaignSubjectVariant('campaign', ' Alex@Example.com ')).toBe(campaignSubjectVariant('campaign', 'alex@example.com'));
        expect(['A', 'B']).toContain(campaignSubjectVariant('campaign', 'alex@example.com'));
    });
    it('allocates both variants without a batch-order dependency', () => {
        const emails = Array.from({ length: 100 }, (_, index) => `customer${index}@example.com`);
        const forward = Object.fromEntries(emails.map(email => [email, campaignSubjectVariant('campaign', email)]));
        const reverse = Object.fromEntries([...emails].reverse().map(email => [email, campaignSubjectVariant('campaign', email)]));
        expect(reverse).toEqual(forward); expect(new Set(Object.values(forward)).size).toBe(2);
    });
});
describe('marketing pressure configuration', () => {
    it('uses safe defaults for invalid deployment values', () => {
        vi.stubEnv('MARKETING_PRESSURE_MAX_SENDS', '-1'); vi.stubEnv('MARKETING_PRESSURE_WINDOW_HOURS', 'NaN');
        expect(marketingPressureConfig()).toEqual({ maxPerWindow: 3, windowHours: 24 });
    });
});
describe('broadcast send readiness', () => {
    const ready = { subject: 'Subject', content: '<a href="{{unsubscribe_url}}">Unsubscribe</a>' };
    it('accepts a real unsubscribe link', () => { expect(() => assertBroadcastReady(ready)).not.toThrow(); });
    it.each([{ ...ready, subject: '' }, { ...ready, content: '' }, { ...ready, content: '<p>Unsubscribe</p>' }, { ...ready, subjectB: '{{}}' }])('blocks incomplete or unsafe send content', value => {
        expect(() => assertBroadcastReady(value)).toThrow();
    });
});
