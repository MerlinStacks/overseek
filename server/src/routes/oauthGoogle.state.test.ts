import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    getGoogleAuthUrl: vi.fn(), exchangeGoogleCode: vi.fn(), updateAccountTokens: vi.fn(), connectAccount: vi.fn(),
    set: vi.fn(), del: vi.fn(),
}));
vi.mock('../utils/redis', () => ({ redisClient: { set: mocks.set, del: mocks.del } }));
vi.mock('../services/ads', () => ({ AdsService: mocks }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'tenant'; } }));
import routes from './oauthGoogle';
import { createSignedOauthState } from './oauthHelpers';
describe('Google Ads OAuth state and tenant forwarding', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks(); vi.stubEnv('OAUTH_STATE_SECRET', 'test-only-state-secret');
        mocks.set.mockResolvedValue('OK'); mocks.del.mockResolvedValue(1);
        mocks.getGoogleAuthUrl.mockImplementation(async (_callback: string, state: string) => `https://accounts.google.test/?state=${state}`);
        mocks.exchangeGoogleCode.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
        mocks.connectAccount.mockResolvedValue({ id: 'pending' });
        app = Fastify(); await app.register(routes); await app.ready();
    });
    afterEach(async () => { await app.close(); vi.unstubAllEnvs(); });
    async function authorize() {
        const response = await app.inject('/google/authorize?reconnectId=ad&redirect=%2Fmarketing');
        expect(response.statusCode).toBe(200);
        return new URL(response.json().authUrl).searchParams.get('state')!;
    }
    it('creates signed, provider-bound state and forwards its tenant for token reconnection', async () => {
        const state = await authorize(); expect(state).toContain('.');
        const response = await app.inject(`/google/callback?code=code&state=${encodeURIComponent(state)}`);
        expect(response.statusCode).toBe(302); expect(response.headers.location).toContain('google_reconnected');
        expect(mocks.updateAccountTokens).toHaveBeenCalledWith('tenant', 'ad', { accessToken: 'access', refreshToken: 'refresh' });
    });
    it('rejects a modified tenant and the formerly accepted unsigned state before exchanging credentials', async () => {
        const original = await authorize(); const [body, signature] = original.split('.');
        const modified = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), accountId: 'foreign' })).toString('base64url');
        for (const state of [`${modified}.${signature}`, modified]) {
            const response = await app.inject(`/google/callback?code=code&state=${encodeURIComponent(state)}`);
            expect(response.headers.location).toContain('invalid_state');
        }
        expect(mocks.exchangeGoogleCode).not.toHaveBeenCalled(); expect(mocks.updateAccountTokens).not.toHaveBeenCalled();
    });
    it('rejects another provider and consumed state', async () => {
        const other = await createSignedOauthState({ accountId: 'tenant', frontendRedirect: '/marketing', provider: 'META_ADS' });
        const response = await app.inject(`/google/callback?code=code&state=${encodeURIComponent(other)}`);
        expect(response.headers.location).toContain('invalid_state');
        mocks.del.mockResolvedValue(0);
        const state = await authorize(); await app.inject(`/google/callback?code=code&state=${encodeURIComponent(state)}`);
        expect(mocks.exchangeGoogleCode).not.toHaveBeenCalled();
    });
});
