import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { segmentAudienceRoutes } from './segmentAudiences';

const mocks = vi.hoisted(() => ({ destinations: vi.fn(), destination: vi.fn(), segment: vi.fn(), upsert: vi.fn(), findSync: vi.fn(), update: vi.fn(), enqueue: vi.fn(), exports: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: {
    adAccount: { findMany: mocks.destinations, findFirst: mocks.destination },
    audienceSync: { upsert: mocks.upsert, findFirst: mocks.findSync, update: mocks.update }
} }));
vi.mock('../services/SegmentService', () => ({ segmentService: { getSegment: mocks.segment, getExportableCustomers: mocks.exports } }));
vi.mock('../services/ads/AudienceSyncService', () => ({ AudienceSyncService: { enqueue: mocks.enqueue }, audienceEmailHashes: () => ['hash'] }));

describe('Segment advertising routes', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.segment.mockResolvedValue({ id: 'segment', name: 'Recent purchasers' });
        mocks.destination.mockResolvedValue({ id: 'destination', platform: 'META' });
        mocks.upsert.mockResolvedValue({ id: 'sync' });
        mocks.exports.mockResolvedValue({ emails: ['person@example.com'] });
        app = Fastify();
        app.addHook('preHandler', async request => { request.accountId = 'tenant'; });
        await app.register(segmentAudienceRoutes, { prefix: '/api/segments' });
        await app.ready();
    });
    afterEach(async () => { await app.close(); });

    it('selects only non-secret destination fields within the tenant', async () => {
        mocks.destinations.mockResolvedValue([]);
        expect((await app.inject('/api/segments/destinations')).statusCode).toBe(200);
        expect(mocks.destinations).toHaveBeenCalledWith({ where: { accountId: 'tenant', platform: { in: ['META', 'GOOGLE'] } }, select: { id: true, name: true, platform: true, externalId: true } });
    });

    it.each([undefined, false, 'true'])('requires explicit advertising consent (%s)', async consentConfirmed => {
        const response = await app.inject({ method: 'POST', url: '/api/segments/segment/audiences', payload: { adAccountId: 'destination', consentConfirmed } });
        expect(response.statusCode).toBe(400);
        expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it('rejects another tenant’s destination before queueing anything', async () => {
        mocks.destination.mockResolvedValue(null);
        const response = await app.inject({ method: 'POST', url: '/api/segments/segment/audiences', payload: { adAccountId: 'foreign', consentConfirmed: true } });
        expect(response.statusCode).toBe(404);
        expect(mocks.destination).toHaveBeenCalledWith({ where: { id: 'foreign', accountId: 'tenant', platform: { in: ['META', 'GOOGLE'] } } });
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it('persists consent, enables hourly syncing and queues the first upload', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/segments/segment/audiences', payload: { adAccountId: 'destination', consentConfirmed: true } });
        expect(response.statusCode).toBe(202);
        expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ accountId: 'tenant', autoSyncEnabled: true, consentConfirmedAt: expect.any(Date) }) }));
        expect(mocks.enqueue).toHaveBeenCalledWith('tenant', 'sync');
    });

    it('cannot pause or resume an audience belonging to another segment or tenant', async () => {
        mocks.findSync.mockResolvedValue(null);
        const response = await app.inject({ method: 'PATCH', url: '/api/segments/segment/audiences/foreign', payload: { enabled: false } });
        expect(response.statusCode).toBe(404);
        expect(mocks.findSync).toHaveBeenCalledWith({ where: { id: 'foreign', segmentId: 'segment', accountId: 'tenant', isLookalike: false } });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('pauses without deleting the platform audience or its acknowledged membership', async () => {
        mocks.findSync.mockResolvedValue({ id: 'sync' });
        const response = await app.inject({ method: 'PATCH', url: '/api/segments/segment/audiences/sync', payload: { enabled: false } });
        expect(response.statusCode).toBe(200);
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'sync' }, data: { autoSyncEnabled: false, status: 'PAUSED' } });
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it.each(['META', 'GOOGLE'])('exports a hashed %s snapshot with no caching', async platform => {
        const response = await app.inject(`/api/segments/segment/ad-export?platform=${platform}`);
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).toBe(`${platform === 'META' ? 'email' : 'Email'}\r\nhash`);
        expect(mocks.segment).toHaveBeenCalledWith('segment', 'tenant');
    });
});
