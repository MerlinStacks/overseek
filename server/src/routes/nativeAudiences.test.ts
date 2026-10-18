import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeAudienceRoutes } from './nativeAudiences';
import { NativeAudienceError } from '../services/ads/NativeAudienceService';

const mocks = vi.hoisted(() => ({ list: vi.fn(), find: vi.fn(), updateMany: vi.fn(), destination: vi.fn(), sources: vi.fn(), create: vi.fn(), enqueue: vi.fn(), reconcile: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { nativeAdAudience: { findMany: mocks.list, findFirst: mocks.find, updateMany: mocks.updateMany } } }));
vi.mock('../services/ads/NativeAudienceService', () => ({
    NativeAudienceError: class extends Error { constructor(message: string, public statusCode = 400) { super(message); } },
    NativeAudienceService: { destination: mocks.destination, sources: mocks.sources, create: mocks.create, enqueue: mocks.enqueue, reconcile: mocks.reconcile }
}));

describe('Native advertising audience API', () => {
    let app: ReturnType<typeof Fastify>;
    const payload = {
        adAccountId: 'ads', name: 'Cart additions', kind: 'WEBSITE', consentConfirmed: true,
        definition: { pixelId: '123', event: 'AddToCart', retentionDays: 14, exclusionDays: 30, excludePurchasers: true }
    };
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.destination.mockResolvedValue({ id: 'ads', platform: 'META' });
        mocks.create.mockResolvedValue({ id: 'native', status: 'PENDING' });
        mocks.list.mockResolvedValue([]);
        mocks.sources.mockResolvedValue({ pixels: [], lookalikeSources: [] });
        mocks.updateMany.mockResolvedValue({ count: 1 });
        app = Fastify();
        app.addHook('preHandler', async request => { request.accountId = 'tenant'; });
        await app.register(nativeAudienceRoutes, { prefix: '/api/segments' });
        await app.ready();
    });
    afterEach(async () => { await app.close(); });

    it('lists only the selected tenant and never includes destination credentials', async () => {
        expect((await app.inject('/api/segments/native-audiences')).statusCode).toBe(200);
        expect(mocks.list).toHaveBeenCalledWith({ where: { accountId: 'tenant' }, orderBy: { createdAt: 'desc' }, take: 200, include: { adAccount: { select: { name: true, platform: true } } } });
    });
    it('scopes source discovery to the selected tenant', async () => {
        expect((await app.inject('/api/segments/native-audiences/sources/ads')).statusCode).toBe(200);
        expect(mocks.sources).toHaveBeenCalledWith('tenant', 'ads');
    });
    it.each([false, 'true', undefined])('requires explicit advertising consent (%s)', async consentConfirmed => {
        const response = await app.inject({ method: 'POST', url: '/api/segments/native-audiences', payload: { ...payload, consentConfirmed } });
        expect(response.statusCode).toBe(400);
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('normalizes rules and delegates creation within the tenant', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/segments/native-audiences', payload: { ...payload, externalId: 'foreign', definition: { ...payload.definition, accessToken: 'attacker' } } });
        expect(response.statusCode).toBe(202);
        expect(mocks.create).toHaveBeenCalledWith('tenant', 'ads', 'WEBSITE', 'Cart additions', payload.definition);
    });
    it('rejects arbitrary event rules before queueing', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/segments/native-audiences', payload: { ...payload, definition: { ...payload.definition, event: 'unsupported' } } });
        expect(response.statusCode).toBe(400);
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('cannot use another tenant’s advertising account', async () => {
        mocks.destination.mockRejectedValue(new NativeAudienceError('Advertising account not found', 404));
        const response = await app.inject({ method: 'POST', url: '/api/segments/native-audiences', payload });
        expect(response.statusCode).toBe(404);
        expect(mocks.destination).toHaveBeenCalledWith('tenant', 'ads');
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('requires the Google tag attestation even if enhanced conversions already exist', async () => {
        mocks.destination.mockResolvedValue({ id: 'ads', platform: 'GOOGLE' });
        const response = await app.inject({ method: 'POST', url: '/api/segments/native-audiences', payload: { ...payload, definition: { ...payload.definition, urlContains: '/checkout/' } } });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('remarketing tag');
    });
    it.each(['CREATING', 'CREATED', 'NEEDS_REVIEW'])('does not retry %s outcomes', async status => {
        mocks.find.mockResolvedValue({ id: 'native', status, externalId: null });
        const response = await app.inject({ method: 'POST', url: '/api/segments/native-audiences/native/retry', payload: { consentConfirmed: true } });
        expect(response.statusCode).toBe(409);
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it('does not retry records from another tenant', async () => {
        mocks.find.mockResolvedValue(null);
        expect((await app.inject({ method: 'POST', url: '/api/segments/native-audiences/foreign/retry', payload: { consentConfirmed: true } })).statusCode).toBe(404);
        expect(mocks.find).toHaveBeenCalledWith({ where: { id: 'foreign', accountId: 'tenant' } });
    });
    it('queues a definitively failed creation after consent reconfirmation', async () => {
        mocks.find.mockResolvedValue({ id: 'native', status: 'FAILED', externalId: null });
        expect((await app.inject({ method: 'POST', url: '/api/segments/native-audiences/native/retry', payload: { consentConfirmed: true } })).statusCode).toBe(202);
        expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: 'native', accountId: 'tenant', status: 'FAILED', externalId: null }, data: { status: 'PENDING', lastError: null, consentConfirmedAt: expect.any(Date) } });
        expect(mocks.enqueue).toHaveBeenCalledWith('tenant', 'native');
    });
    it('reconciles uncertain creation using tenant scope rather than a caller-supplied external ID', async () => {
        mocks.reconcile.mockResolvedValue({ id: 'native', status: 'CREATED' });
        expect((await app.inject({ method: 'POST', url: '/api/segments/native-audiences/native/reconcile', payload: { externalId: 'foreign' } })).statusCode).toBe(200);
        expect(mocks.reconcile).toHaveBeenCalledWith('tenant', 'native');
    });
});
