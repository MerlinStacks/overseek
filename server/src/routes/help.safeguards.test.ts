import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ collections: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() }, articles: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() } }));
vi.mock('../utils/prisma', () => ({ prisma: { helpCollection: m.collections, helpArticle: m.articles } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any, reply: any) => { if (!request.headers.authorization) return reply.code(401).send({ error: 'Sign in' }); }, requireSuperAdminFastify: async (request: any, reply: any) => { if (request.headers['x-role'] !== 'super') return reply.code(403).send({ error: 'Forbidden' }); } }));
import helpRoutes from './help';
const headers = { authorization: 'token', 'x-role': 'super' };
describe('validated help routes', () => {
    let app: FastifyInstance;
    beforeEach(async () => { vi.resetAllMocks(); m.articles.findMany.mockResolvedValue([]); m.articles.create.mockImplementation(async ({ data }) => data); m.articles.update.mockResolvedValue({}); app = Fastify(); await app.register(helpRoutes); });
    afterEach(async () => { await app.close(); });
    it('keeps writes restricted to authenticated super-admins', async () => {
        expect((await app.inject({ method: 'POST', url: '/articles', payload: {} })).statusCode).toBe(401); expect((await app.inject({ method: 'POST', url: '/articles', headers: { authorization: 'token' }, payload: {} })).statusCode).toBe(403); expect(m.articles.create).not.toHaveBeenCalled();
    });
    it.each([{ title: ' ', slug: 'slug' }, { title: 'Title', slug: '../bad' }, { title: 'Title', slug: 'valid', order: 1.5 }, { title: 'Title', slug: 'valid', unexpected: true }])('rejects invalid collection input %j', async payload => {
        expect((await app.inject({ method: 'POST', url: '/collections', headers, payload })).statusCode).toBe(400); expect(m.collections.create).not.toHaveBeenCalled();
    });
    it('defaults new articles to drafts unless publishing is explicitly requested', async () => {
        const payload = { collectionId: 'collection', title: 'Title', slug: 'title', content: '<p>Content</p>' };
        expect((await app.inject({ method: 'POST', url: '/articles', headers, payload })).json().isPublished).toBe(false);
        expect((await app.inject({ method: 'POST', url: '/articles', headers, payload: { ...payload, isPublished: true } })).json().isPublished).toBe(true);
    });
    it('trims and bounds searches without querying the database for blank queries', async () => {
        expect((await app.inject({ url: '/search?q=%20%20' })).json()).toEqual([]); expect(m.articles.findMany).not.toHaveBeenCalled();
        expect((await app.inject({ url: `/search?q=${'a'.repeat(201)}` })).statusCode).toBe(400);
        await app.inject({ url: '/search?q=%20orders%20' }); expect(m.articles.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isPublished: true, OR: expect.arrayContaining([{ title: { contains: 'orders', mode: 'insensitive' } }]) }) }));
    });
    it('does not expose draft articles or increment their public view count', async () => {
        m.articles.findUnique.mockResolvedValue({ id: 'draft', isPublished: false, content: 'Private draft' }); const response = await app.inject({ url: '/articles/title' }); expect(response.statusCode).toBe(404); expect(response.body).not.toContain('Private draft'); expect(m.articles.update).not.toHaveBeenCalled();
    });
    it.each([['P2002', 409], ['P2025', 404], ['P2003', 400]])('maps persistence error %s to %s', async (code, expected) => {
        m.collections.update.mockRejectedValue({ code }); expect((await app.inject({ method: 'PUT', url: '/collections/id', headers, payload: { title: 'Title', slug: 'title' } })).statusCode).toBe(expected);
    });
});
