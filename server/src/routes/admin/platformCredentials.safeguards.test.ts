import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), remove: vi.fn(), transaction: vi.fn(), clear: vi.fn(), clearPush: vi.fn(), clearSearch: vi.fn(), smtp: vi.fn(), keys: vi.fn(), prompts: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() } }));
vi.mock('../../utils/prisma', () => ({ prisma: { platformCredentials: { findMany: m.findMany, findUnique: m.findUnique, upsert: m.upsert, create: m.create, delete: m.remove }, $transaction: m.transaction, aIPrompt: m.prompts } }));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async (request: any, reply: any) => { if (!request.headers.authorization) return reply.code(401).send({ error: 'Sign in' }); }, requireSuperAdminFastify: async (request: any, reply: any) => { if (request.headers['x-role'] !== 'super') return reply.code(403).send({ error: 'Forbidden' }); } }));
vi.mock('../../services/PlatformEmailService', () => ({ platformEmailService: { testConnection: m.smtp } }));
vi.mock('../../services/ads/types', () => ({ clearCredentialsCache: m.clear }));
vi.mock('web-push', () => ({ default: { generateVAPIDKeys: m.keys } }));
vi.mock('../../services/PushNotificationService', () => ({ PushNotificationService: { clearCredentialsCache: m.clearPush } }));
vi.mock('../../services/search-console/SerpCheckService', () => ({ SerpCheckService: { clearCache: m.clearSearch } }));
import { platformCredentialsRoutes } from './platformCredentials';
const headers = { authorization: 'Bearer token', 'x-role': 'super' };
const record = { id: 'credential', platform: 'GOOGLE_ADS', credentials: { clientId: 'client', clientSecret: 'private-secret', developerToken: 'private-developer-token' } };
describe('platform credential safeguards', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
        vi.resetAllMocks(); m.findMany.mockResolvedValue([record]); m.findUnique.mockResolvedValue(record); m.remove.mockResolvedValue(record);
        m.transaction.mockImplementation(task => task({ platformCredentials: { findUnique: m.findUnique, upsert: m.upsert } }));
        m.upsert.mockImplementation(async args => ({ ...record, credentials: args.update.credentials }));
        app = Fastify(); await app.register(platformCredentialsRoutes);
    });
    afterEach(async () => { await app.close(); });
    it('retains authentication and super-admin checks', async () => {
        expect((await app.inject({ url: '/platform-credentials' })).statusCode).toBe(401);
        expect((await app.inject({ url: '/platform-credentials', headers: { authorization: 'token' } })).statusCode).toBe(403); expect(m.findMany).not.toHaveBeenCalled();
    });
    it('never exposes secrets in list or single responses, including four-character prefixes', async () => {
        for (const url of ['/platform-credentials', '/platform-credentials/GOOGLE_ADS']) {
            const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store'); expect(response.body).not.toContain('private-'); expect(response.body).toContain('********');
        }
    });
    it('merges partial edits while preserving masked or omitted secrets', async () => {
        const response = await app.inject({ method: 'PUT', url: '/platform-credentials/GOOGLE_ADS', headers, payload: { credentials: { clientId: 'new-client', clientSecret: '********', developerToken: 'priv********' } } });
        expect(response.statusCode).toBe(200); expect(m.upsert.mock.calls[0][0].update.credentials).toEqual({ ...record.credentials, clientId: 'new-client' }); expect(m.clear).toHaveBeenCalled(); expect(response.body).not.toContain('private-secret');
    });
    it.each([{ credentials: [] }, { credentials: { clientSecret: 123 } }, { credentials: { unexpected: 'secret' } }])('rejects malformed fields %j', async payload => {
        expect((await app.inject({ method: 'PUT', url: '/platform-credentials/GOOGLE_ADS', headers, payload })).statusCode).toBe(400); expect(m.upsert).not.toHaveBeenCalled();
    });
    it('rejects mask placeholders on new credentials and invalid SMTP ports before testing', async () => {
        m.findUnique.mockResolvedValue(null);
        expect((await app.inject({ method: 'PUT', url: '/platform-credentials/GOOGLE_ADS', headers, payload: { credentials: { clientSecret: '********' } } })).statusCode).toBe(400);
        for (const port of ['587x', 587.5, 0, 65536]) expect((await app.inject({ method: 'POST', url: '/platform-smtp/test', headers, payload: { host: 'smtp.test', port, username: 'user', password: 'password' } })).statusCode).toBe(400);
        expect(m.smtp).not.toHaveBeenCalled();
    });
    it('uses a stored SMTP password only for a recognized unchanged marker', async () => {
        m.findUnique.mockResolvedValue({ credentials: { password: 'private-password' } }); m.smtp.mockResolvedValue({ success: true });
        expect((await app.inject({ method: 'POST', url: '/platform-smtp/test', headers, payload: { host: 'smtp.test', port: '587', username: 'user', password: '********', secure: false } })).statusCode).toBe(200);
        expect(m.smtp).toHaveBeenCalledWith(expect.objectContaining({ password: 'private-password', port: 587, secure: false }));
    });
    it('invalidates credentials after deletion and maps missing records to 404', async () => {
        expect((await app.inject({ method: 'DELETE', url: '/platform-credentials/GOOGLE_ADS', headers })).statusCode).toBe(200); expect(m.clear).toHaveBeenCalled();
        m.remove.mockRejectedValue({ code: 'P2025' }); expect((await app.inject({ method: 'DELETE', url: '/platform-credentials/GOOGLE_ADS', headers })).statusCode).toBe(404);
    });
    it('invalidates push and custom-search credential caches on deletion too', async () => {
        await app.inject({ method: 'DELETE', url: '/platform-credentials/WEB_PUSH_VAPID', headers }); expect(m.clearPush).toHaveBeenCalledOnce();
        await app.inject({ method: 'DELETE', url: '/platform-credentials/GOOGLE_CUSTOM_SEARCH', headers }); expect(m.clearSearch).toHaveBeenCalledOnce();
    });
    it('does not replace keys when another request wins the VAPID create race', async () => {
        m.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ credentials: { publicKey: 'existing-public', privateKey: 'existing-private' } }); m.keys.mockReturnValue({ publicKey: 'new-public', privateKey: 'new-private' }); m.create.mockRejectedValue({ code: 'P2002' });
        const response = await app.inject({ method: 'POST', url: '/generate-vapid-keys', headers }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ publicKey: 'existing-public', alreadyExists: true }); expect(response.body).not.toContain('private'); expect(m.upsert).not.toHaveBeenCalled();
    });
    it('never generates keys when a complete or incomplete configuration already exists', async () => {
        m.findUnique.mockResolvedValue({ credentials: { publicKey: 'existing-public' } }); expect((await app.inject({ method: 'POST', url: '/generate-vapid-keys', headers })).statusCode).toBe(409); expect(m.keys).not.toHaveBeenCalled();
    });
    it('validates prompt bodies before any persistent mutation', async () => {
        expect((await app.inject({ method: 'PUT', url: '/ai-prompts/prompt', headers, payload: { content: '  ' } })).statusCode).toBe(400); expect(m.prompts.upsert).not.toHaveBeenCalled();
    });
});
