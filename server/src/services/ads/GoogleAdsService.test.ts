import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleAdsService } from './GoogleAdsService';

vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
vi.mock('./GoogleAdsAuth', () => ({ GoogleAdsAuth: {} }));
vi.mock('./GoogleAdsClient', () => ({
    createGoogleAdsRestConfig: vi.fn(async () => ({ customerId: '123', currency: 'AUD' })),
    recordGrpcFailure: vi.fn(), extractGrpcErrorMessage: String,
}));

afterEach(() => vi.unstubAllGlobals());

describe('Google campaign channel metadata', () => {
    it.each(['advertisingChannelType', 'advertising_channel_type'])(
        'requests and preserves %s from Google', async key => {
            const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ results: [{
                campaign: { id: '1', name: 'Embroidery', status: 'ENABLED', [key]: 'SHOPPING' },
                metrics: {},
            }] })));
            vi.stubGlobal('fetch', fetchMock);

            const campaigns = await GoogleAdsService.getCampaignInsights('connected', 7);

            expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).query).toContain('campaign.advertising_channel_type');
            expect(campaigns[0]).toMatchObject({ campaignId: '1', advertisingChannelType: 'SHOPPING' });
        }
    );
});
