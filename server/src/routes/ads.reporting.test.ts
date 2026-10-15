import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAdAccounts: vi.fn(), getMetaCampaignInsights: vi.fn(), getGoogleCampaignInsights: vi.fn(),
    getEntityInsights: vi.fn(), generateFromCampaigns: vi.fn()
}));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'tenant'; } }));
vi.mock('../services/ads', () => ({ AdsService: mocks }));
vi.mock('../services/ads/MetaAdsService', () => ({ MetaAdsService: mocks }));
vi.mock('../services/tools/knowledge/RecommendationEngine', () => ({ RecommendationEngine: mocks }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('./ads/actions', () => ({ adsActionsRoutes: async () => {} }));
vi.mock('./ads/copy', () => ({ adCopyRoutes: async () => {} }));
vi.mock('./ads/intelligence', () => ({ default: async () => {} }));
import adsRoutes from './ads';

describe('Ads reporting routes', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        mocks.getAdAccounts.mockResolvedValue([{ id: 'meta', platform: 'META' }, { id: 'google', platform: 'GOOGLE' }]);
        mocks.getEntityInsights.mockResolvedValue([]);
        mocks.getMetaCampaignInsights.mockResolvedValue([{ campaignId: '123' }]);
        mocks.getGoogleCampaignInsights.mockResolvedValue([{ campaignId: '456' }]);
        mocks.generateFromCampaigns.mockReturnValue([{ campaignName: 'Selected campaign', text: 'Review performance' }]);
        app = Fastify();
        await app.register(adsRoutes, { prefix: '/api/ads' });
        await app.ready();
    });
    afterEach(async () => { await app.close(); vi.clearAllMocks(); });

    it('loads only the selected Meta hierarchy under the authorised tenant', async () => {
        const res = await app.inject('/api/ads/meta/meta-entities?level=adset&parentId=123&days=7');
        expect(res.statusCode).toBe(200);
        expect(mocks.getAdAccounts).toHaveBeenCalledWith('tenant');
        expect(mocks.getEntityInsights).toHaveBeenCalledWith('meta', 7, 'adset', '123');
    });

    it.each(['level=campaign&parentId=123', 'level=ad&parentId=invalid', 'level=adset'])('rejects invalid hierarchy parameters: %s', async query => {
        const res = await app.inject(`/api/ads/meta/meta-entities?${query}`);
        expect(res.statusCode).toBe(400);
        expect(mocks.getEntityInsights).not.toHaveBeenCalled();
    });

    it('rejects Google accounts for Meta drill-down', async () => {
        const res = await app.inject('/api/ads/google/meta-entities?level=ad&parentId=123');
        expect(res.statusCode).toBe(400);
        expect(mocks.getEntityInsights).not.toHaveBeenCalled();
    });

    it.each(['meta-entities?level=ad&parentId=123', 'analysis?days=7'])('rejects accounts outside the tenant: %s', async endpoint => {
        const res = await app.inject(`/api/ads/other-tenant-account/${endpoint}`);
        expect(res.statusCode).toBe(404);
        expect(mocks.getEntityInsights).not.toHaveBeenCalled();
        expect(mocks.generateFromCampaigns).not.toHaveBeenCalled();
    });

    it.each(['meta', 'google'])('scopes %s recommendations to the selected account and period', async platform => {
        const res = await app.inject(`/api/ads/${platform}/analysis?days=14`);
        expect(res.statusCode).toBe(200);
        const getter = platform === 'meta' ? mocks.getMetaCampaignInsights : mocks.getGoogleCampaignInsights;
        expect(getter).toHaveBeenCalledWith(platform, 14);
        expect(mocks.generateFromCampaigns).toHaveBeenCalledWith([{ campaignId: platform === 'meta' ? '123' : '456' }], platform);
        expect(res.json()).toEqual({
            suggestions: ['Selected campaign: Review performance'],
            scope: { adAccountId: platform, days: 14 }, source: 'knowledge_base'
        });
    });
});
