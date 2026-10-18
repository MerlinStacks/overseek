import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import segmentsRoutes from './segments';

const mocks = vi.hoisted(() => ({ getSegment: vi.fn(), getSegmentCount: vi.fn() }));
vi.mock('../services/SegmentService', () => ({ segmentService: mocks }));
vi.mock('./segmentAudiences', () => ({ segmentAudienceRoutes: async () => {} }));
vi.mock('./nativeAudiences', () => ({ nativeAudienceRoutes: async () => {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any, reply: any) => {
    if (!request.headers.authorization) return reply.code(401).send({ error: 'Authentication required' });
    request.accountId = 'tenant';
} }));

describe('Customer segment count endpoint', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.getSegment.mockResolvedValue({ id: 'segment' });
        mocks.getSegmentCount.mockResolvedValue(1234);
        app = Fastify();
        await app.register(segmentsRoutes, { prefix: '/api/segments' });
        await app.ready();
    });
    afterEach(async () => { await app.close(); });
    const headers = { authorization: 'Bearer test' };
    it('returns the authoritative matching-customer count, scoped to the account', async () => {
        const result = await app.inject({ url: '/api/segments/segment/count', headers });
        expect(result.statusCode).toBe(200);
        expect(result.json()).toEqual({ count: 1234 });
        expect(result.headers['cache-control']).toBe('no-store');
        expect(mocks.getSegment).toHaveBeenCalledWith('segment', 'tenant');
        expect(mocks.getSegmentCount).toHaveBeenCalledWith('tenant', 'segment');
    });
    it('does not return zero for a missing or foreign segment', async () => {
        mocks.getSegment.mockResolvedValue(null);
        expect((await app.inject({ url: '/api/segments/foreign/count', headers })).statusCode).toBe(404);
        expect(mocks.getSegmentCount).not.toHaveBeenCalled();
    });
    it('supports a genuine empty segment', async () => {
        mocks.getSegmentCount.mockResolvedValue(0);
        expect((await app.inject({ url: '/api/segments/segment/count', headers })).json()).toEqual({ count: 0 });
    });
    it('returns an error, not a fabricated count, if evaluation fails', async () => {
        mocks.getSegmentCount.mockRejectedValue(new Error('Query failed'));
        expect((await app.inject({ url: '/api/segments/segment/count', headers })).statusCode).toBe(500);
    });
    it('requires authentication before querying membership', async () => {
        expect((await app.inject('/api/segments/segment/count')).statusCode).toBe(401);
        expect(mocks.getSegmentCount).not.toHaveBeenCalled();
    });
});
