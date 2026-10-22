import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, states: new Map<string, Record<string, unknown>>(), create: vi.fn(), claim: vi.fn(), upsert: vi.fn(), exchange: vi.fn() }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: { accountId: string; user: unknown }) => { request.accountId = 'a'; request.user = { id: 'u' }; } }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: async () => m.allowed } }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('./oauthHelpers', () => ({ buildCallbackUrl: () => 'https://app.test/api/oauth/tiktok/callback', buildFrontendUrl: (path: string, query: Record<string, string>) => { const url = new URL(path, 'https://app.test'); url.searchParams.set(Object.keys(query)[0], Object.values(query)[0]); return url.toString(); } }));
vi.mock('../services/messaging/TikTokMessagingService', () => ({ TikTokMessagingService: { exchangeAuthCode: (...args: unknown[]) => m.exchange(...args) } }));
vi.mock('../utils/prisma', () => ({ prisma: {
    platformCredentials: { findUnique: async () => ({ credentials: { clientKey: 'key', clientSecret: 'secret' } }) },
    oauthConnectionState: { create: (...args: unknown[]) => m.create(...args), findUnique: async ({ where }: { where: { tokenHash: string } }) => m.states.get(where.tokenHash), updateMany: (...args: unknown[]) => m.claim(...args) }, socialAccount: { upsert: (...args: unknown[]) => m.upsert(...args) },
} }));
import oauthTikTokRoutes from './oauthTikTok';
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
    vi.clearAllMocks(); m.allowed = true; m.states.clear();
    m.create.mockImplementation(async ({ data }) => { m.states.set(data.tokenHash, data); return data; });
    m.claim.mockImplementation(async ({ where, data }) => { const row = m.states.get(where.tokenHash); if (!row || row.consumedAt) return { count: 0 }; row.consumedAt = data.consumedAt; return { count: 1 }; });
    m.exchange.mockResolvedValue({ openId: 'open', accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 }); m.upsert.mockResolvedValue({});
    app = Fastify(); await app.register(oauthTikTokRoutes, { prefix: '/api/oauth' });
});
afterEach(async () => { await app.close(); });
async function authorize() { const response = await app.inject('/api/oauth/tiktok/authorize'); return { state: new URL(response.json().authUrl).searchParams.get('state')!, cookie: String(response.headers['set-cookie']).split(';')[0] }; }
it('uses opaque browser-bound single-use state and blocks callback replay', async () => {
    const { state, cookie } = await authorize(); expect(state).toMatch(/^[a-f0-9]{64}$/); expect([...m.states.values()][0]).toMatchObject({ accountId: 'a', userId: 'u', provider: 'TIKTOK_MESSAGING' });
    const url = `/api/oauth/tiktok/callback?code=code&state=${state}`;
    expect((await app.inject({ url, headers: { cookie } })).headers.location).toContain('success=tiktok_connected');
    expect((await app.inject({ url, headers: { cookie } })).headers.location).toContain('error=invalid_state'); expect(m.exchange).toHaveBeenCalledOnce(); expect(m.upsert).toHaveBeenCalledOnce();
});
it('rejects unsigned state and missing browser binding before provider calls', async () => {
    const forged = Buffer.from(JSON.stringify({ accountId: 'victim' })).toString('base64url'); await app.inject(`/api/oauth/tiktok/callback?code=code&state=${forged}`);
    const { state } = await authorize(); await app.inject(`/api/oauth/tiktok/callback?code=code&state=${state}`); expect(m.exchange).not.toHaveBeenCalled();
});
it('fails closed on expiry, provider mismatch and permission revocation', async () => {
    const { state, cookie } = await authorize(); const row = [...m.states.values()][0]; row.expiresAt = new Date(0);
    await app.inject({ url: `/api/oauth/tiktok/callback?code=c&state=${state}`, headers: { cookie } }); expect(m.exchange).not.toHaveBeenCalled();
    row.expiresAt = new Date(Date.now() + 60000); row.provider = 'OTHER'; await app.inject({ url: `/api/oauth/tiktok/callback?code=c&state=${state}`, headers: { cookie } }); expect(m.exchange).not.toHaveBeenCalled();
    row.provider = 'TIKTOK_MESSAGING'; m.allowed = false; await app.inject({ url: `/api/oauth/tiktok/callback?code=c&state=${state}`, headers: { cookie } }); expect(m.exchange).not.toHaveBeenCalled();
});
it('rejects unsafe redirects and malformed tokens and exposes no provider errors', async () => {
    expect((await app.inject('/api/oauth/tiktok/authorize?redirect=https%3A%2F%2Fevil.test')).statusCode).toBe(400);
    const { state, cookie } = await authorize(); m.exchange.mockResolvedValue({ accessToken: 'secret', expiresIn: Infinity });
    const response = await app.inject({ url: `/api/oauth/tiktok/callback?code=c&state=${state}`, headers: { cookie } }); expect(response.headers.location).toContain('token_exchange_failed'); expect(m.upsert).not.toHaveBeenCalled();
});
it('does not emit an authorization URL when durable state storage fails', async () => { m.create.mockRejectedValue(Error('offline')); const response = await app.inject('/api/oauth/tiktok/authorize'); expect(response.statusCode).toBe(503); expect(response.json()).not.toHaveProperty('authUrl'); });
