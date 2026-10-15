import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creativeRoutes } from './creatives';
import { AIRequestError } from '../../services/ai/OpenRouterClient';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), getReport: vi.fn(), review: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { adAccount: { findFirst: mocks.findFirst } } }));
vi.mock('../../services/ads/MetaCreativeService', () => ({ MetaCreativeService: { getReport: mocks.getReport } }));
vi.mock('../../services/ads/CreativeReviewService', () => ({ CreativeReviewService: { review: mocks.review } }));

describe('Creative API scope and validation', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.findFirst.mockResolvedValue({ id: 'connected', platform: 'META' });
        mocks.getReport.mockResolvedValue({ creatives: [] });
        mocks.review.mockResolvedValue({ summary: 'Review' });
        app = Fastify();
        app.addHook('preHandler', async request => { (request as any).accountId = 'tenant'; });
        await app.register(creativeRoutes, { prefix: '/api/ads' });
        await app.ready();
    });
    afterEach(async () => { await app.close(); });

    it('loads creative comparisons in the selected tenant, ad account, ad set and period', async () => {
        const res = await app.inject('/api/ads/connected/creatives?adsetId=456&days=30');
        expect(res.statusCode).toBe(200);
        expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'connected', accountId: 'tenant' }, select: { id: true, platform: true } });
        expect(mocks.getReport).toHaveBeenCalledWith('connected', '456', 30);
        expect(mocks.review).not.toHaveBeenCalled();
    });

    it.each(['adsetId=abc', 'adsetId=456&days=0', 'adsetId=456&days=366', 'days=30'])('rejects malformed query %s', async query => {
        const res = await app.inject(`/api/ads/connected/creatives?${query}`);
        expect(res.statusCode).toBe(400);
        expect(mocks.getReport).not.toHaveBeenCalled();
    });

    it('rejects accounts belonging to a different tenant', async () => {
        mocks.findFirst.mockResolvedValue(null);
        const res = await app.inject('/api/ads/connected/creatives?adsetId=456');
        expect(res.statusCode).toBe(404);
        expect(mocks.getReport).not.toHaveBeenCalled();
    });

    it('rejects Google accounts', async () => {
        mocks.findFirst.mockResolvedValue({ platform: 'GOOGLE' });
        expect((await app.inject('/api/ads/connected/creatives?adsetId=456')).statusCode).toBe(400);
    });

    it('defaults to text-only AI and ignores client-provided evidence', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/ads/connected/creative-review', payload: { adsetId: '456', creativeId: '500', metrics: { spend: 0 }, imageUrl: 'https://attacker.test/image' } });
        expect(res.statusCode).toBe(200);
        expect(mocks.review).toHaveBeenCalledWith('tenant', 'connected', '456', '500', 30, false);
    });

    it('passes explicit visual opt-in and surfaces typed provider failures', async () => {
        mocks.review.mockRejectedValue(new AIRequestError('Provider busy', 429));
        const res = await app.inject({ method: 'POST', url: '/api/ads/connected/creative-review', payload: { adsetId: '456', creativeId: '500', days: 7, includeVisuals: true } });
        expect(mocks.review).toHaveBeenCalledWith('tenant', 'connected', '456', '500', 7, true);
        expect(res.statusCode).toBe(429);
        expect(res.json()).toEqual({ error: 'Provider busy' });
    });
});
