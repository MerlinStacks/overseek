import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, scope: true, create: vi.fn(), update: vi.fn(), remove: vi.fn(), many: vi.fn(), one: vi.fn(), cleanup: vi.fn(), prompt: vi.fn(), promptCreate: vi.fn() }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = m.scope ? 'a' : undefined; request.user = { id: 'u' }; } }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: async () => m.allowed } }));
vi.mock('../utils/cache', () => ({ cacheDelete: m.cleanup }));
vi.mock('../utils/prisma', () => { const tx = { $queryRaw: vi.fn(), policy: { create: m.create, updateMany: m.update, deleteMany: m.remove, findMany: m.many, findFirst: m.one, findFirstOrThrow: m.one }, aIPrompt: { findMany: async () => [], findUnique: async () => ({ name: 'Default', content: 'Base', updatedAt: new Date('2026-10-01') }) }, accountAIPrompt: { findUnique: m.prompt, findMany: async () => [], create: m.promptCreate } }; return { prisma: { ...tx, $transaction: async (run: (db: unknown) => unknown) => run(tx) } }; });
import routes from './policies';
const policy = { id: '88dcd3bd-8957-43c3-9685-ad15814bf441', title: 'Policy', content: 'Text', type: 'POLICY', category: null, isPublished: false };
let app: ReturnType<typeof Fastify>;
beforeEach(async () => { vi.clearAllMocks(); m.allowed = true; m.scope = true; m.create.mockResolvedValue({ ...policy, updatedAt: new Date('2026-10-01') }); m.one.mockResolvedValue({ ...policy, updatedAt: new Date('2026-10-02') }); m.update.mockResolvedValue({ count: 1 }); m.prompt.mockResolvedValue(null); m.many.mockResolvedValue([]); app = Fastify(); await app.register(routes); });
afterEach(async () => { await app.close(); });
it('rejects missing scope and feature permission before reads/writes', async () => { m.scope = false; expect((await app.inject('/')).statusCode).toBe(400); m.scope = true; m.allowed = false; expect((await app.inject({ method: 'POST', url: '/', payload: policy })).statusCode).toBe(403); expect(m.create).not.toHaveBeenCalled(); });
it('does not misreport committed creation when cache cleanup fails', async () => { m.cleanup.mockRejectedValue(Error('offline')); expect((await app.inject({ method: 'POST', url: '/', payload: policy })).statusCode).toBe(200); });
it('requires versions and scopes final conditional writes, rejecting conflicts', async () => {
    const { id, ...fields } = policy;
    expect((await app.inject({ method: 'PUT', url: `/${id}`, payload: fields })).statusCode).toBe(400);
    m.update.mockResolvedValue({ count: 0 }); expect((await app.inject({ method: 'PUT', url: `/${id}`, payload: { ...fields, version: '2026-10-01T00:00:00.000Z' } })).statusCode).toBe(409); expect(m.update.mock.calls[0][0].where).toMatchObject({ accountId: 'a', id });
});
it('bounds pagination and rejects unknown prompt IDs/nonstring content', async () => {
    expect((await app.inject('/?limit=1000')).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/ai-prompts/unknown', payload: { content: 'x', version: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/ai-prompts/review_reply', payload: { content: [], version: 'x' } })).statusCode).toBe(400); expect(m.promptCreate).not.toHaveBeenCalled();
});
it('compares the effective default/override version before prompt mutation', async () => { expect((await app.inject({ method: 'PUT', url: '/ai-prompts/review_reply', payload: { content: 'x', version: 'default:old' } })).statusCode).toBe(409); expect(m.promptCreate).not.toHaveBeenCalled(); });
