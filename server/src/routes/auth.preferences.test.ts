import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { user: { update: mocks.update } } }));
vi.mock('../services/PlatformEmailService', () => ({ platformEmailService: {} }));
vi.mock('../services/SecurityService', () => ({ SecurityService: {} }));
vi.mock('../services/PermissionService', () => ({ PermissionService: {} }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.user = { id: 'current-user' }; } }));
vi.mock('../utils/auth', () => ({ hashPassword: vi.fn(), comparePassword: vi.fn() }));
vi.mock('../utils/redis', () => ({ redisClient: {} }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import authRoutes from './auth';

describe('personal date and time preferences API', () => {
    const apps: ReturnType<typeof Fastify>[] = [];
    beforeEach(() => vi.resetAllMocks());
    afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
    async function update(payload: Record<string, unknown>) {
        const app = Fastify();
        apps.push(app);
        await app.register(authRoutes);
        return app.inject({ method: 'PUT', url: '/me', payload });
    }
    it('saves only allowed fields for the authenticated user', async () => {
        const preferences = { timezone: 'Australia/Sydney', dateFormat: 'dmy', timeFormat: '24h' };
        mocks.update.mockResolvedValue({ id: 'current-user', ...preferences, passwordHash: 'secret' });
        const response = await update({ ...preferences, id: 'other-user', isSuperAdmin: true });
        expect(response.statusCode).toBe(200);
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'current-user' }, data: preferences });
        expect(response.json()).not.toHaveProperty('passwordHash');
    });
    it.each([{ timezone: 'Invalid/Zone' }, { timezone: '' }, { timezone: 123 }, { dateFormat: 'invalid' }, { timeFormat: 'invalid' }])('rejects invalid preferences %j', async payload => {
        expect((await update(payload)).statusCode).toBe(400);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('allows clearing preferences and preserves unrelated profile updates', async () => {
        mocks.update.mockResolvedValue({ id: 'current-user' });
        expect((await update({ timezone: null, dateFormat: null, timeFormat: null })).statusCode).toBe(200);
        expect(mocks.update.mock.calls[0][0].data).toEqual({ timezone: null, dateFormat: null, timeFormat: null });
        await update({ fullName: 'Test User' });
        expect(mocks.update.mock.calls[1][0].data).toEqual({ fullName: 'Test User' });
    });
});
