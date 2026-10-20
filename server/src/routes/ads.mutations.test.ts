import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getAdAccounts: vi.fn(), updateAccount: vi.fn(), disconnectAccount: vi.fn(), connectAccount: vi.fn() }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'tenant'; } }));
vi.mock('../services/ads', () => ({ AdsService: mocks }));
vi.mock('../services/ads/MetaAdsService', () => ({ MetaAdsService: {} }));
vi.mock('../services/tools/knowledge/RecommendationEngine', () => ({ RecommendationEngine: {} }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./ads/actions', () => ({ adsActionsRoutes: async () => {} }));
vi.mock('./ads/copy', () => ({ adCopyRoutes: async () => {} }));
vi.mock('./ads/intelligence', () => ({ default: async () => {} }));
vi.mock('./ads/creatives', () => ({ creativeRoutes: async () => {} }));
import routes from './ads';
describe('ads mutation integration', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks(); mocks.getAdAccounts.mockResolvedValue([{ id: 'ad', platform: 'GOOGLE', externalId: 'PENDING_SETUP' }]);
        mocks.updateAccount.mockResolvedValue({ id: 'ad', externalId: '123456', accessToken: 'test-access-token-with-private-tail' });
        app = Fastify(); await app.register(routes, { prefix: '/ads' }); await app.ready();
    });
    afterEach(async () => { await app.close(); });
    it('atomically updates name and normalized external ID with tenant scope and masks tokens', async () => {
        const response = await app.inject({ method: 'PATCH', url: '/ads/ad', payload: { name: 'Name', externalId: '123-456' } });
        expect(response.statusCode).toBe(200);
        expect(mocks.updateAccount).toHaveBeenCalledWith('tenant', 'ad', { name: 'Name', externalId: '123456' });
        expect(response.json().externalId).toBe('123456'); expect(response.body).not.toContain('test-access-token-with-private-tail');
    });
    it('passes tenant scope for deletes and setup completion', async () => {
        const deleted = await app.inject({ method: 'DELETE', url: '/ads/ad' }); expect(deleted.statusCode).toBe(200);
        expect(mocks.disconnectAccount).toHaveBeenCalledWith('tenant', 'ad');
        const setup = await app.inject({ method: 'PATCH', url: '/ads/ad/complete-setup', payload: { customerId: '123-456' } });
        expect(setup.statusCode).toBe(200); expect(mocks.updateAccount).toHaveBeenCalledWith('tenant', 'ad', { name: 'Google Ads (123-456)', externalId: '123456' });
    });
    it('never mutates an account absent from the current tenant', async () => {
        for (const method of ['PATCH', 'DELETE'] as const) {
            const response = await app.inject({ method, url: '/ads/foreign', ...(method === 'PATCH' ? { payload: { name: 'Name' } } : {}) });
            expect(response.statusCode).toBe(404);
        }
        expect(mocks.updateAccount).not.toHaveBeenCalled(); expect(mocks.disconnectAccount).not.toHaveBeenCalled();
    });
    it('returns validation failures as 400 rather than server errors', async () => {
        mocks.connectAccount.mockRejectedValue(Object.assign(new Error('Invalid ad account input'), { statusCode: 400 }));
        const response = await app.inject({ method: 'POST', url: '/ads/connect', payload: { platform: 'OTHER', externalId: 'id', accessToken: 'token' } });
        expect(response.statusCode).toBe(400);
    });
});
