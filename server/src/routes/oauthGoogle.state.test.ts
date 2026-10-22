import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, states: new Map<string, any>(), create: vi.fn(), claim: vi.fn(), getGoogleAuthUrl: vi.fn(), exchangeGoogleCode: vi.fn(), updateAccountTokens: vi.fn(), connectAccount: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { oauthConnectionState: { create: m.create, findUnique: async ({ where }: any) => m.states.get(where.tokenHash), updateMany: m.claim }, adAccount: { findFirst: async () => ({ id: 'ad' }) } } }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: async () => m.allowed } }));
vi.mock('../services/ads', () => ({ AdsService: m }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'tenant'; request.user = { id: 'user' }; } }));
import routes from './oauthGoogle';
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
    vi.clearAllMocks(); m.states.clear(); m.allowed = true;
    m.create.mockImplementation(async ({ data }) => { m.states.set(data.tokenHash, data); });
    m.claim.mockImplementation(async ({ where, data }) => { const row = m.states.get(where.tokenHash); if (row.consumedAt) return { count: 0 }; row.consumedAt = data.consumedAt; return { count: 1 }; });
    m.getGoogleAuthUrl.mockImplementation(async (_callback, state) => `https://accounts.google.test/?state=${state}`);
    m.exchangeGoogleCode.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
    app = Fastify(); await app.register(routes);
});
afterEach(async () => { await app.close(); });
async function authorize() {
    const response = await app.inject('/google/authorize?reconnectId=ad&redirect=%2Fmarketing'); expect(response.statusCode).toBe(200);
    return { state: new URL(response.json().authUrl).searchParams.get('state')!, cookie: String(response.headers['set-cookie']).split(';')[0] };
}
it('uses browser-bound opaque state, forwards trusted tenant and rejects replay', async () => {
    const { state, cookie } = await authorize(); expect(state).toMatch(/^[a-f0-9]{64}$/);
    const url = `/google/callback?code=code&state=${state}`;
    expect((await app.inject({ url, headers: { cookie } })).headers.location).toContain('google_reconnected');
    expect(m.updateAccountTokens).toHaveBeenCalledWith('tenant', 'ad', { accessToken: 'access', refreshToken: 'refresh' });
    expect((await app.inject({ url, headers: { cookie } })).headers.location).toContain('invalid_state'); expect(m.exchangeGoogleCode).toHaveBeenCalledOnce();
});
it('rejects missing browser proof, provider mismatch, expiry and forged legacy state', async () => {
    const { state, cookie } = await authorize(); const url = `/google/callback?code=c&state=${state}`;
    expect((await app.inject(url)).headers.location).toContain('invalid_state');
    const row = [...m.states.values()][0]; row.provider = 'META_ADS'; expect((await app.inject({ url, headers: { cookie } })).headers.location).toContain('invalid_state');
    row.provider = 'GOOGLE_ADS'; row.expiresAt = new Date(0); expect((await app.inject({ url, headers: { cookie } })).headers.location).toContain('invalid_state');
    await app.inject('/google/callback?code=c&state=forged.signature'); expect(m.exchangeGoogleCode).not.toHaveBeenCalled();
});
it('fails closed when durable creation or permissions fail', async () => {
    m.create.mockRejectedValueOnce(Error('offline')); expect((await app.inject('/google/authorize')).statusCode).toBe(503);
    const { state, cookie } = await authorize(); m.allowed = false;
    await app.inject({ url: `/google/callback?code=c&state=${state}`, headers: { cookie } }); expect(m.exchangeGoogleCode).not.toHaveBeenCalled();
});
it('consumes denial state without exposing provider error text', async () => {
    const { state, cookie } = await authorize(); const response = await app.inject({ url: `/google/callback?error=secret&state=${state}`, headers: { cookie } });
    expect(response.headers.location).toContain('oauth_denied'); expect(response.headers.location).not.toContain('secret'); expect([...m.states.values()][0].consumedAt).toBeInstanceOf(Date);
});
