import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
vi.mock('./GoogleAdsAuth', () => ({ GoogleAdsAuth: {} }));
vi.mock('./GoogleAdsClient', () => ({ createGoogleAdsRestConfig: async () => ({ customerId: '123', currency: 'AUD' }), recordGrpcFailure: vi.fn(), extractGrpcErrorMessage: String }));
import { GoogleAdsService } from './GoogleAdsService';
afterEach(() => vi.unstubAllGlobals());
describe('strict paid keyword reads', () => {
    it('honors the selected summary reporting window', async () => {
        const search = vi.spyOn(GoogleAdsService as any, 'searchRows').mockResolvedValue({ rows: [{ customer: { currencyCode: 'EUR' }, metrics: { costMicros: 1000000, clicks: 1, impressions: 2, conversionsValue: 3 } }], currency: 'EUR' });
        try {
            const result = await GoogleAdsService.getInsights('ad', { startDate: '2026-10-01', endDate: '2026-10-17' });
            expect(search.mock.calls[0][1]).toContain("BETWEEN '2026-10-01' AND '2026-10-17'"); expect(result).toMatchObject({ spend: 1, currency: 'EUR', date_start: '2026-10-01', date_stop: '2026-10-17' });
        } finally { search.mockRestore(); }
    });
    it('preserves legacy fallback and propagates strict failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('Unavailable', { status: 503 })));
        expect(await GoogleAdsService.getSearchKeywords('ad')).toEqual([]);
        await expect(GoogleAdsService.getSearchKeywords('ad', 28, 500, { strict: true })).rejects.toThrow();
    });
    it('uses the supplied end date and a matching UTC start date', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ results: [] })));
        vi.stubGlobal('fetch', fetchMock);
        await GoogleAdsService.getSearchKeywords('ad', 28, 500, { strict: true, endDate: '2026-10-17' });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain("BETWEEN '20260919' AND '20261017'");
    });
    it.each([{ results: 'invalid' }, { results: [], nextPageToken: 'more' }])('rejects malformed or incomplete responses', async body => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(body))));
        await expect(GoogleAdsService.getSearchKeywords('ad', 28, 500, { strict: true })).rejects.toThrow();
    });
});
