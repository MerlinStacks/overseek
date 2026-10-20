import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { socialAccount: mocks } }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = request.headers['x-account-id']; } }));
vi.mock('./oauthHelpers', () => ({ buildCallbackUrl: () => 'https://api.test/callback', getApiBase: () => 'https://api.test' }));
vi.mock('./oauthGoogle', () => ({ default: async () => {} }));
vi.mock('./oauthMeta', () => ({ default: async () => {} }));
vi.mock('./oauthTikTok', () => ({ default: async () => {} }));
vi.mock('./oauthSearchConsole', () => ({ default: async () => {} }));
import routes from './oauth';
describe('social account tenant boundaries', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => { vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); mocks.updateMany.mockResolvedValue({ count: 1 }); app = Fastify(); await app.register(routes); });
    afterEach(async () => { await app.close(); });
    it('rejects both operations without an account before accessing Prisma', async () => {
        expect((await app.inject('/social-accounts')).statusCode).toBe(400);
        expect((await app.inject({ method: 'DELETE', url: '/social-accounts/id' })).statusCode).toBe(400);
        expect(mocks.findMany).not.toHaveBeenCalled(); expect(mocks.updateMany).not.toHaveBeenCalled();
    });
    it('scopes reads and disconnects to the selected account', async () => {
        await app.inject({ url: '/social-accounts', headers: { 'x-account-id': 'tenant' } });
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'tenant', isActive: true } }));
        await app.inject({ method: 'DELETE', url: '/social-accounts/id', headers: { 'x-account-id': 'tenant' } });
        expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: 'id', accountId: 'tenant' }, data: { isActive: false } });
    });
    it('reports a missing or foreign account without a false success', async () => {
        mocks.updateMany.mockResolvedValue({ count: 0 });
        expect((await app.inject({ method: 'DELETE', url: '/social-accounts/foreign', headers: { 'x-account-id': 'tenant' } })).statusCode).toBe(404);
    });
    it('does not expose database details in failure responses', async () => {
        mocks.findMany.mockRejectedValue(new Error('private database detail'));
        const response = await app.inject({ url: '/social-accounts', headers: { 'x-account-id': 'tenant' } });
        expect(response.statusCode).toBe(500); expect(response.body).not.toContain('private');
    });
});
