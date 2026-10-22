import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, scope: true, products: vi.fn(), claim: vi.fn(), release: vi.fn(), generate: vi.fn() }));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = m.scope ? 'a' : undefined; request.user = { id: 'u', accountId: 'untrusted' }; } }));
vi.mock('../../services/PermissionService', () => ({ PermissionService: { hasPermission: async () => m.allowed } }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: async () => ({ name: 'Store', wooUrl: 'https://store.test' }) }, wooProduct: { findMany: m.products } } }));
vi.mock('../../services/tools/AdCopyQuota', () => ({ claimAdCopyGeneration: m.claim }));
vi.mock('../../services/tools/AdCopyGenerator', () => ({ AdCopyGenerator: { generate: m.generate, generateForMeta: m.generate, generateForBothPlatforms: m.generate } }));
import routes from './copy';
let app: ReturnType<typeof Fastify>;
beforeEach(async () => { vi.clearAllMocks(); m.allowed = true; m.scope = true; m.release.mockResolvedValue(undefined); m.claim.mockResolvedValue(m.release); m.products.mockResolvedValue([{ id: 'p', name: 'Product', sku: 's' }]); m.generate.mockResolvedValue({ headlines: ['View options'], descriptions: ['Review product details online'], source: 'template' }); app = Fastify(); await app.register(routes); });
afterEach(async () => { await app.close(); });
it('rejects missing scope and permission before generation or product reads', async () => {
    m.scope = false; expect((await app.inject({ method: 'POST', url: '/generate', payload: {} })).statusCode).toBe(400);
    m.scope = true; m.allowed = false; expect((await app.inject({ method: 'POST', url: '/generate', payload: {} })).statusCode).toBe(403); expect(m.products).not.toHaveBeenCalled(); expect(m.claim).not.toHaveBeenCalled();
});
it.each([{ platform: 'unknown' }, { customContext: { storeName: 'Override' } }, { productId: 'p', productName: 'Name' }, { tonePreset: [] }])('rejects malformed or authoritative override options %j', async payload => { expect((await app.inject({ method: 'POST', url: '/generate', payload })).statusCode).toBe(400); expect(m.claim).not.toHaveBeenCalled(); });
it('uses trusted account, durable work admission and unavailable AOV', async () => {
    expect((await app.inject({ method: 'POST', url: '/generate', payload: { productId: 'p', customContext: { brandVoice: 'Plain' } } })).statusCode).toBe(200);
    expect(m.products).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', id: { in: ['p'] } } })); expect(m.claim).toHaveBeenCalledWith('a', 1); expect(m.generate.mock.calls[0][1]).toMatchObject({ avgOrderValue: null, storeName: 'Store', brandVoice: 'Plain' }); expect(m.release).toHaveBeenCalledOnce();
});
it('bounds bulk work and validates generated shapes', async () => {
    expect((await app.inject({ method: 'POST', url: '/bulk-generate', payload: { tonePreset: 'professional', platform: 'google', maxProducts: -1 } })).statusCode).toBe(400);
    m.generate.mockResolvedValue({ headlines: [{}], descriptions: [], source: 'ai' }); expect((await app.inject({ method: 'POST', url: '/generate', payload: {} })).statusCode).toBe(503); expect(m.release).toHaveBeenCalledOnce();
});
it('does not generate when durable admission fails', async () => { m.claim.mockRejectedValue(Object.assign(Error('busy'), { statusCode: 429 })); expect((await app.inject({ method: 'POST', url: '/generate', payload: {} })).statusCode).toBe(429); expect(m.generate).not.toHaveBeenCalled(); });
