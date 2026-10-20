import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ recent: vi.fn(), resource: vi.fn() }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = request.headers['x-account-id']; } }));
vi.mock('../services/AuditService', () => ({ AuditService: { getRecentLogs: mocks.recent, getLogsForResource: mocks.resource } }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import routes from './audits';
describe('audit pagination', () => {
    let app: ReturnType<typeof Fastify>;
    const headers = { 'x-account-id': 'tenant' };
    beforeEach(async () => { vi.resetAllMocks(); mocks.recent.mockResolvedValue([]); mocks.resource.mockResolvedValue([]); app = Fastify(); await app.register(routes); });
    afterEach(async () => { await app.close(); });
    it('preserves array responses with bounded defaults and tenant scope', async () => {
        expect((await app.inject({ url: '/recent', headers })).json()).toEqual([]); expect(mocks.recent).toHaveBeenCalledWith('tenant', 50, 0);
        await app.inject({ url: '/order/id?limit=20&page=3', headers }); expect(mocks.resource).toHaveBeenCalledWith('tenant', 'ORDER', 'id', 20, 40);
    });
    it.each(['limit=-1', 'limit=201', 'limit=abc', 'limit=1.5', 'page=0', 'page=100001'])('rejects invalid pagination %s', async query => {
        expect((await app.inject({ url: `/recent?${query}`, headers })).statusCode).toBe(400); expect(mocks.recent).not.toHaveBeenCalled();
    });
    it('rejects missing account scope', async () => { expect((await app.inject('/recent')).statusCode).toBe(400); expect(mocks.recent).not.toHaveBeenCalled(); });
});
