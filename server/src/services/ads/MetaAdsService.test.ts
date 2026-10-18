import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaAdsService } from './MetaAdsService';
import { AdsService } from '../ads';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { adAccount: { findUnique } } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./GoogleAdsService', () => ({ GoogleAdsService: {} }));

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
});
const row = (id: string, spend: string) => ({
    campaign_id: id, campaign_name: `Campaign ${id}`, spend, impressions: '1000', clicks: '20',
    actions: [{ action_type: 'purchase', value: '2' }, { action_type: 'omni_purchase', value: '2' }],
    action_values: [{ action_type: 'purchase', value: '100' }]
});

describe('Meta Ads reporting', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
        findUnique.mockResolvedValue({ platform: 'META', externalId: '123', accessToken: 'secret', currency: 'AUD' });
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

    it('includes paused historical spend, joins real statuses, and follows both cursors', async () => {
        const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
            const url = new URL(input);
            expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
            expect(url.searchParams.has('access_token')).toBe(false);
            if (url.pathname.endsWith('/campaigns')) {
                return url.searchParams.has('after')
                    ? json({ data: [{ id: '2', effective_status: 'PAUSED' }] })
                    : json({ data: [{ id: '1', effective_status: 'ACTIVE' }], paging: { next: 'https://untrusted.test', cursors: { after: 'metadata-next' } } });
            }
            expect(url.origin).toBe('https://graph.facebook.com');
            expect(url.searchParams.has('filtering')).toBe(false);
            expect(JSON.parse(url.searchParams.get('time_range')!)).toEqual({ since: '2026-10-09', until: '2026-10-15' });
            return url.searchParams.has('after')
                ? json({ data: [row('2', '50')] })
                : json({ data: [row('1', '25')], paging: { next: 'https://untrusted.test', cursors: { after: 'insights-next' } } });
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await AdsService.getMetaCampaignInsights('connected', 7);
        expect(result.map(c => [c.campaignId, c.status, c.spend])).toEqual([['2', 'PAUSED', 50], ['1', 'ACTIVE', 25]]);
        expect(result[0]).toMatchObject({ conversions: 2, conversionsValue: 100, roas: 2, cpa: 25, currency: 'AUD' });
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it.each(['adset', 'ad'] as const)('filters %s insights to the selected parent within the account', async level => {
        vi.stubGlobal('fetch', vi.fn(async (input: string) => {
            const url = new URL(input);
            if (!url.pathname.endsWith('/insights')) return json({ data: [] });
            expect(url.pathname).toBe('/v24.0/act_123/insights');
            expect(url.searchParams.get('level')).toBe(level);
            expect(JSON.parse(url.searchParams.get('filtering')!)).toEqual([
                { field: `${level === 'adset' ? 'campaign' : 'adset'}.id`, operator: 'IN', value: ['456'] }
            ]);
            return json({ data: [{ [`${level}_id`]: '789', [`${level}_name`]: 'Child' }] });
        }));
        const result = await MetaAdsService.getEntityInsights('connected', 7, level, '456');
        expect(result[0]).toMatchObject({ campaignId: '789', campaignName: 'Child', status: 'UNKNOWN' });
    });

    it('paginates daily trends without silently truncating them', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: string) => new URL(input).searchParams.has('after')
            ? json({ data: [{ date_start: '2026-10-15', spend: '20' }] })
            : json({ data: [{ date_start: '2026-10-14', spend: '10' }], paging: { next: 'next', cursors: { after: 'page2' } } })));
        const result = await MetaAdsService.getDailyTrends('connected', 7);
        expect(result.map(day => day.spend)).toEqual([10, 20]);
    });

    it('preserves actionable Meta error messages on non-2xx JSON responses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'Access token expired' } }, 400)));
        await expect(MetaAdsService.getCampaignInsights('connected', 7)).rejects.toThrow('Access token expired');
    });

    it('fails rather than returning partial results on a repeated cursor', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ data: [], paging: { next: 'next', cursors: { after: 'same' } } })));
        await expect(MetaAdsService.getDailyTrends('connected', 7)).rejects.toThrow('repeated pagination cursor');
    });
});
