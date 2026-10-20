import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ global: vi.fn(), semantic: vi.fn(), similar: vi.fn(), batch: vi.fn(), membership: vi.fn() }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = request.headers['x-account-id']; request.user = { id: 'user' }; } }));
vi.mock('../services/search/SearchQueryService', () => ({ SearchQueryService: { globalSearch: mocks.global } }));
vi.mock('../services/EmbeddingService', () => ({ EmbeddingService: { semanticSearch: mocks.semantic, findSimilarProducts: mocks.similar, batchUpdateEmbeddings: mocks.batch } }));
vi.mock('../utils/prisma', () => ({ prisma: { accountUser: { findUnique: mocks.membership } } }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import routes from './search';
describe('search request validation and authorization', () => {
    let app: ReturnType<typeof Fastify>;
    const headers = { 'x-account-id': 'tenant' };
    beforeEach(async () => { vi.resetAllMocks(); mocks.semantic.mockResolvedValue([]); mocks.batch.mockResolvedValue(2); mocks.membership.mockResolvedValue({ role: 'ADMIN' }); app = Fastify(); await app.register(routes); });
    afterEach(async () => { await app.close(); });
    it.each(['-1', '0', '1.5', 'NaN', '1000', '10abc'])('rejects invalid search limit %s before provider calls', async limit => {
        expect((await app.inject({ url: `/semantic?q=query&limit=${limit}`, headers })).statusCode).toBe(400);
        expect((await app.inject({ url: `/similar/product?limit=${limit}`, headers })).statusCode).toBe(400);
        expect(mocks.semantic).not.toHaveBeenCalled(); expect(mocks.similar).not.toHaveBeenCalled();
    });
    it('trims semantic queries and applies a bounded default limit', async () => {
        expect((await app.inject({ url: '/semantic?q=%20query%20', headers })).statusCode).toBe(200);
        expect(mocks.semantic).toHaveBeenCalledWith('tenant', 'query', 10);
        expect((await app.inject({ url: '/semantic?q=%20%20', headers })).statusCode).toBe(400);
    });
    it('requires an account before search work', async () => {
        expect((await app.inject('/semantic?q=query')).statusCode).toBe(400); expect(mocks.semantic).not.toHaveBeenCalled();
    });
    it.each(['STAFF', 'VIEWER'])('denies embedding generation to %s', async role => {
        mocks.membership.mockResolvedValue({ role });
        expect((await app.inject({ method: 'POST', url: '/embeddings/generate', headers, payload: {} })).statusCode).toBe(403); expect(mocks.batch).not.toHaveBeenCalled();
    });
    it('allows admins and validates generation batch bounds', async () => {
        expect((await app.inject({ method: 'POST', url: '/embeddings/generate', headers, payload: { limit: 501 } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: '/embeddings/generate', headers, payload: {} })).json()).toEqual({ success: true, updated: 2 });
        expect(mocks.batch).toHaveBeenCalledWith('tenant', 100);
    });
});
