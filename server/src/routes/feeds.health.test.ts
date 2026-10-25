import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const mocks = vi.hoisted(() => ({ health: vi.fn(), record: vi.fn(), enabled: vi.fn(), token: vi.fn(), xml: vi.fn(), csv: vi.fn(), filters: vi.fn(), rows: vi.fn(), refs: vi.fn(), saveMappings: vi.fn() }));
vi.mock('../services/feedHealth', () => ({ getFeedHealth: mocks.health, recordFeedExport: mocks.record }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any, reply: any) => {
    if (!request.headers.authorization) return reply.code(401).send({ error: 'Authentication required' });
    request.accountId = request.headers['x-account-id'];
} }));
vi.mock('../utils/accountFeatures', () => ({ isAccountFeatureEnabled: mocks.enabled }));
vi.mock('../services/queue/QueueFactory', () => ({ QueueFactory: {}, QUEUES: {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../services/feedMapping', () => ({ FEED_FEATURE_KEY: 'FEED_EXPORTS', FeedMappingService: {
    parseChannel: (channel: string) => {
        if (!['google', 'meta', 'pinterest', 'similar'].includes(channel)) throw new Error('Unsupported feed channel');
        return channel;
    },
    validateFeedExportToken: mocks.token, getFeedExportXml: mocks.xml, getFeedExportCsv: mocks.csv, setProductFilters: mocks.filters,
    getFeedRows: mocks.rows, getFeedRowRefs: mocks.refs,
    saveMappings: mocks.saveMappings,
} }));
import feedsRoutes from './feeds';
import feedExportRoutes from './feedExport';

describe('feed health and export routes', () => {
    let app: ReturnType<typeof Fastify>;
    const headers = { authorization: 'Bearer test', 'x-account-id': 'account-2' };
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.enabled.mockResolvedValue(true);
        mocks.health.mockResolvedValue({ included: 2, platformAcceptance: 'not_verified' });
        mocks.token.mockResolvedValue(true);
        mocks.record.mockResolvedValue(undefined);
        mocks.xml.mockResolvedValue('<rss/>');
        mocks.csv.mockResolvedValue('id,title\n1,Mug');
        mocks.rows.mockResolvedValue({ rows: [], total: 0, mappings: [] });
        mocks.refs.mockResolvedValue({ rows: [], total: 0 });
        app = Fastify();
        await app.register(feedsRoutes, { prefix: '/feeds' });
        await app.register(feedExportRoutes, { prefix: '/feeds' });
    });
    afterEach(async () => { await app.close(); });

    it('preserves manual source and fallback values through the mapping schema', async () => {
        const mappings = [{ targetField: 'brand', sourceField: 'manual', manualValue: 'CustomKings', fallbackSourceField: 'manual', fallbackManualValue: 'Fallback brand' }];
        mocks.saveMappings.mockResolvedValue(mappings);
        const response = await app.inject({ method: 'PUT', url: '/feeds/mappings/google', headers, payload: { mappings } });
        expect(response.statusCode).toBe(200);
        expect(mocks.saveMappings).toHaveBeenCalledWith('account-2', 'google', mappings);
        expect(response.json().mappings).toEqual(mappings);
    });

    it('requires authentication, account context and the feed feature for health', async () => {
        expect((await app.inject('/feeds/google/health')).statusCode).toBe(401);
        expect((await app.inject({ url: '/feeds/google/health', headers: { authorization: 'Bearer test' } })).statusCode).toBe(400);
        mocks.enabled.mockResolvedValue(false);
        expect((await app.inject({ url: '/feeds/google/health', headers })).statusCode).toBe(403);
        expect(mocks.health).not.toHaveBeenCalled();
    });
    it('uses the authenticated account and validates channel/mode', async () => {
        const response = await app.inject({ url: '/feeds/meta/health?variationMode=first_variation', headers });
        expect(response.statusCode).toBe(200);
        expect(mocks.health).toHaveBeenCalledWith('account-2', 'meta', 'first_variation');
        expect(response.json().platformAcceptance).toBe('not_verified');
        expect((await app.inject({ url: '/feeds/meta/health?variationMode=invalid', headers })).statusCode).toBe(400);
        expect((await app.inject({ url: '/feeds/invalid/health', headers })).statusCode).toBe(400);
    });
    it('round-trips the opt-in stock override through the settings schema', async () => {
        const payload = { excludeOutOfStockProducts: true, excludeUnpublishedProducts: false, backordersAsInStock: true };
        mocks.filters.mockResolvedValue(payload);
        expect((await app.inject({ method: 'PUT', url: '/feeds/settings/product-filters', headers, payload })).json()).toEqual(payload);
        expect(mocks.filters).toHaveBeenCalledWith('account-2', payload);
    });
    it('defaults rows, references, health and exports to automatic and accepts explicit automatic mode', async () => {
        expect((await app.inject({ url: '/feeds/google/rows', headers })).statusCode).toBe(200);
        expect(mocks.rows).toHaveBeenCalledWith('account-2', 'google', 1, 50, '', 'automatic', undefined, false, false);
        expect((await app.inject({ url: '/feeds/meta/row-refs?variationMode=automatic', headers })).statusCode).toBe(200);
        expect(mocks.refs).toHaveBeenCalledWith('account-2', 'meta', '', 'automatic');
        expect((await app.inject({ url: '/feeds/meta/health', headers })).statusCode).toBe(200);
        expect(mocks.health).toHaveBeenCalledWith('account-2', 'meta', 'automatic');
        expect((await app.inject('/feeds/export/account-1/meta?token=secret')).statusCode).toBe(200);
        expect(mocks.csv).toHaveBeenCalledWith('account-1', 'meta', 'automatic');
        expect((await app.inject('/feeds/export/account-1/google?token=secret&variationMode=automatic')).statusCode).toBe(200);
        expect(mocks.xml).toHaveBeenCalledWith('account-1', 'google', 'automatic');
    });
    it('opts into product-based UI pagination without changing export requests', async () => {
        mocks.rows.mockResolvedValue({ rows: [{ rowId: 'v:1-11' }], groups: [{ rowId: 'g:1' }], total: 1, mappings: [] });
        const response = await app.inject({ url: '/feeds/google/rows?groupVariants=true&page=2&limit=25', headers });
        expect(response.statusCode).toBe(200);
        expect(response.json().groups).toEqual([{ rowId: 'g:1' }]);
        expect(mocks.rows).toHaveBeenCalledWith('account-2', 'google', 2, 25, '', 'automatic', undefined, false, true);
    });
    it.each(['google', 'meta'])('preserves signed %s exports and records local generation only', async (channel) => {
        const response = await app.inject(`/feeds/export/account-1/${channel}?token=secret&variationMode=last_variation`);
        expect(response.statusCode).toBe(200);
        expect(mocks.token).toHaveBeenCalledWith('account-1', channel, 'secret');
        expect(mocks.record).toHaveBeenCalledWith('account-1', channel, 'last_variation', true);
        expect(response.headers['content-type']).toContain(channel === 'meta' ? 'text/csv' : 'application/xml');
    });
    it('does not record invalid-token attempts as legitimate feed failures', async () => {
        mocks.token.mockResolvedValue(false);
        expect((await app.inject('/feeds/export/account-1/google?token=wrong')).statusCode).toBe(403);
        expect(mocks.record).not.toHaveBeenCalled();
        expect(mocks.xml).not.toHaveBeenCalled();
    });
    it('records a generation failure without exposing internal errors', async () => {
        mocks.xml.mockRejectedValue(new Error('private SQL error'));
        const response = await app.inject('/feeds/export/account-1/google?token=secret');
        expect(response.statusCode).toBe(500);
        expect(response.body).not.toContain('private SQL');
        expect(mocks.record).toHaveBeenCalledWith('account-1', 'google', 'automatic', false);
    });
    it('does not fail a valid export when telemetry is unavailable', async () => {
        mocks.record.mockRejectedValue(new Error('Redis unavailable'));
        const response = await app.inject('/feeds/export/account-1/google?token=secret');
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('<rss/>');
    });
});
