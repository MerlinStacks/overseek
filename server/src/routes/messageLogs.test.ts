import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), allowed: vi.fn(), email: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'account'; request.user = { id: 'user' }; } }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: mocks.allowed } }));
vi.mock('../utils/accountFeatures', () => ({ isAccountFeatureEnabled: mocks.email }));
import { messageLogRoutes } from './messageLogs';

beforeEach(() => { vi.clearAllMocks(); mocks.allowed.mockResolvedValue(true); mocks.email.mockResolvedValue(true); mocks.query.mockImplementation(async sql => sql.sql.includes('COUNT(*)') ? [{ total: 2n }] : [{ id: 'email', channel: 'email' }, { id: 'sms', channel: 'sms' }]); });
async function get(query = '') { const app = Fastify(); await app.register(messageLogRoutes); const response = await app.inject(`/logs${query}`); await app.close(); return response; }
describe('tenant-scoped combined message logs', () => {
    it('globally orders and paginates both channels in the database', async () => {
        const response = await get('?channel=both&limit=20&offset=20');
        expect(response.statusCode).toBe(200); expect(response.json().total).toBe(2);
        const query = mocks.query.mock.calls.find(([sql]) => !sql.sql.includes('COUNT(*)'))![0];
        expect(query.sql).toContain('UNION ALL'); expect(query.sql).toContain('ORDER BY "createdAt" DESC, channel ASC, id DESC LIMIT');
        expect(query.values.filter((value: unknown) => value === 'account')).toHaveLength(2);
    });
    it('parameterizes search and escapes wildcard characters', async () => {
        const search = "x%_'; DROP TABLE";
        await get(`?search=${encodeURIComponent(search)}`);
        const query = mocks.query.mock.calls[0][0];
        expect(query.sql).not.toContain('DROP TABLE');
        expect(query.values).toContain("%x\\%\\_'; DROP TABLE%");
    });
    it.each(['?limit=-1', '?offset=-1', '?channel=all', '?limit=1000'])('rejects invalid pagination/filter values %s', async query => {
        expect((await get(query)).statusCode).toBe(400); expect(mocks.query).not.toHaveBeenCalled();
    });
    it('denies readers without marketing permission', async () => {
        mocks.allowed.mockResolvedValue(false); expect((await get()).statusCode).toBe(403); expect(mocks.query).not.toHaveBeenCalled();
    });
    it('does not allow explicit email access when the feature is disabled', async () => {
        mocks.email.mockResolvedValue(false); expect((await get('?channel=email')).statusCode).toBe(403); expect(mocks.query).not.toHaveBeenCalled();
    });
});
