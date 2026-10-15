import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assessCreativeFatigue, MetaCreativeService, parseCreative, safeMetaImageUrl } from './MetaCreativeService';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { adAccount: { findUnique } } }));

const row = (id: string, spend = 100, impressions = 2000, clicks = 100, frequency = 2) => ({
    ad_id: id, ad_name: `Ad ${id}`, spend, impressions, clicks, frequency,
    actions: [{ action_type: 'purchase', value: 10 }, { action_type: 'omni_purchase', value: 10 }],
    action_values: [{ action_type: 'purchase', value: 500 }]
});
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

describe('Meta creative data', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
        findUnique.mockResolvedValue({ platform: 'META', externalId: '123', accessToken: 'secret', currency: 'AUD' });
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

    it('extracts copy, CTA and carousel images without accepting arbitrary media URLs', () => {
        const creative = parseCreative({ id: '5', name: 'Carousel', object_story_spec: { link_data: {
            message: 'Our latest collection', name: 'Find your style', link: 'https://store.example/products',
            call_to_action: { type: 'SHOP_NOW' }, child_attachments: [
                { name: 'First item', picture: 'https://scontent.fbcdn.net/first.jpg' },
                { picture: 'http://127.0.0.1/private.jpg' }
            ]
        } } }, '1');
        expect(creative).toMatchObject({ format: 'carousel', primaryTexts: ['Our latest collection'], callToActions: ['SHOP_NOW'], destinationUrl: 'https://store.example/products' });
        expect(creative.headlines).toEqual(['Find your style', 'First item']);
        expect(creative.assets).toEqual([{ kind: 'image', url: 'https://scontent.fbcdn.net/first.jpg' }]);
    });

    it('labels dynamic video assets as thumbnails, not inspected videos', () => {
        const creative = parseCreative({ id: '5', asset_feed_spec: {
            bodies: [{ text: 'Primary A' }, { text: 'Primary B' }], titles: [{ text: 'Headline A' }],
            videos: [{ video_id: '789', thumbnail_url: 'https://video.fbcdn.net/thumb.jpg' }], call_to_action_types: ['LEARN_MORE']
        } }, '1');
        expect(creative.format).toBe('dynamic');
        expect(creative.primaryTexts).toEqual(['Primary A', 'Primary B']);
        expect(creative.assets[0].kind).toBe('video_thumbnail');
    });

    it.each(['https://fbcdn.net.attacker.test/a', 'https://localhost/a', 'javascript:alert(1)', 'https://user:pass@scontent.fbcdn.net/a', 'https://scontent.fbcdn.net/a?access_token=secret'])('rejects unsafe preview URL %s', url => {
        expect(safeMetaImageUrl(url)).toBeNull();
    });

    it('groups reused creative IDs and calculates weighted ratios without double-counting purchases', async () => {
        const fetchMock = vi.fn(async (input: string) => {
            const url = new URL(input);
            expect(url.pathname.startsWith('/v24.0/act_123/')).toBe(true);
            expect(JSON.parse(url.searchParams.get('filtering')!)).toEqual([{ field: 'adset.id', operator: 'IN', value: ['456'] }]);
            if (url.pathname.endsWith('/ads')) return json({ data: [
                { id: '1', name: 'First ad', adset_id: '456', effective_status: 'ACTIVE', creative: { id: '500', name: 'Shared creative', body: 'Hello' } },
                { id: '2', name: 'Second ad', adset_id: '456', effective_status: 'PAUSED', creative: { id: '500', name: 'Shared creative', body: 'Hello' } }
            ] });
            return json({ data: [row('1', 100, 2000, 100), row('2', 200, 1000, 20)] });
        });
        vi.stubGlobal('fetch', fetchMock);
        const report = await MetaCreativeService.getReport('connected', '456', 30);
        expect(report.creatives).toHaveLength(1);
        expect(report.creatives[0].metrics).toMatchObject({ spend: 300, impressions: 3000, clicks: 120, purchases: 20, revenue: 1000, ctr: 4, cpa: 15 });
        expect(report.creatives[0].ads.map(ad => ad.status)).toEqual(['ACTIVE', 'PAUSED']);
        expect(report.comparison).toEqual({ recentSince: '2026-10-08', recentUntil: '2026-10-14', previousSince: '2026-10-01', previousUntil: '2026-10-07' });
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('requires sufficient selected history and never invents missing media', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: string) => new URL(input).pathname.endsWith('/ads')
            ? json({ data: [] }) : json({ data: [row('1')] })));
        const report = await MetaCreativeService.getReport('connected', '456', 7);
        expect(report.comparison).toBeNull();
        expect(report.creatives[0].creative).toMatchObject({ id: 'unavailable-1', assets: [], format: 'unknown' });
        expect(report.creatives[0].fatigue.status).toBe('insufficient_data');
    });
});

describe('Creative fatigue heuristics', () => {
    it('requires frequency and deteriorating performance together', () => {
        const fatigue = assessCreativeFatigue([row('1', 100, 2000, 60, 4)], [row('1')], true);
        expect(fatigue.status).toBe('potential_fatigue');
        expect(fatigue.reasons.some(reason => reason.includes('CTR fell 40%'))).toBe(true);
    });
    it('does not call high frequency alone fatigue', () => {
        expect(assessCreativeFatigue([row('1', 100, 2000, 100, 5)], [row('1')], true).status).toBe('no_signal');
    });
    it('does not call a CTR drop without repeated exposure fatigue', () => {
        expect(assessCreativeFatigue([row('1', 100, 2000, 60, 1)], [row('1')], true).status).toBe('no_signal');
    });
    it('marks low-volume comparisons as insufficient data', () => {
        expect(assessCreativeFatigue([row('1', 100, 100, 3, 5)], [row('1')], true).status).toBe('insufficient_data');
    });
});
