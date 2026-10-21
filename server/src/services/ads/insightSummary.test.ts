import { describe, expect, it } from 'vitest';
import { insightRange, summarizeInsights } from './insightSummary';
const range = { startDate: '2026-10-01', endDate: '2026-10-20' };
const metric = { accountId: 'a', spend: 10, clicks: 4, impressions: 10, roas: 2, currency: 'EUR', date_start: range.startDate, date_stop: range.endDate };
describe('complete ad summaries', () => {
    it('uses weighted ROAS and source currency only for matching windows', () => {
        expect(summarizeInsights([metric, { ...metric, spend: 30, roas: 4 }], range)).toMatchObject({ hasData: true, spend: 40, roas: 3.5, currency: 'EUR', period: range });
    });
    it('distinguishes an absent provider account from a measured zero', () => {
        expect(summarizeInsights([], range)).toMatchObject({ hasData: false, spend: null, roas: null }); expect(summarizeInsights([{ ...metric, spend: 0, roas: 0 }], range)).toMatchObject({ hasData: true, spend: 0, roas: 0 });
    });
    it.each([null, { ...metric, currency: 'USD' }, { ...metric, currency: '' }, { ...metric, date_stop: '2026-10-19' }, { ...metric, spend: NaN }])('rejects partial or incompatible totals %#', invalid => {
        expect(() => summarizeInsights([metric, invalid], range)).toThrow();
    });
    it.each([{ startDate: '2026-02-31', endDate: '2026-03-02' }, { startDate: '2026-10-02', endDate: '2026-10-01' }, { startDate: '2026-10-01' }, { startDate: '2026-10-01\' OR TRUE', endDate: '2026-10-20' }])('rejects malformed reporting ranges %#', query => {
        expect(() => insightRange(query)).toThrow('Provide a valid');
    });
});
