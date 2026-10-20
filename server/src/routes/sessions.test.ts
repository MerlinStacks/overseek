import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    user: { id: 'user-1', sessionId: 'current' } as { id?: string; sessionId?: string },
    findMany: vi.fn(), updateMany: vi.fn(),
}));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.user = mocks.user; } }));
vi.mock('../utils/prisma', () => ({ prisma: { refreshToken: { findMany: mocks.findMany, updateMany: mocks.updateMany } } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
import routes from './sessions';

describe('session routes', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.user = { id: 'user-1', sessionId: 'current' };
        mocks.findMany.mockResolvedValue([{ id: 'current' }, { id: 'other' }]);
        mocks.updateMany.mockResolvedValue({ count: 1 });
        app = Fastify();
        await app.register(routes);
    });
    afterEach(async () => { await app.close(); });

    it('lists only active user sessions without selecting token secrets', async () => {
        const response = await app.inject({ method: 'GET', url: '/' });
        expect(response.json()).toEqual([{ id: 'current', isCurrent: true }, { id: 'other', isCurrent: false }]);
        expect(mocks.findMany).toHaveBeenCalledWith({
            where: { userId: 'user-1', revokedAt: null, expiresAt: { gt: expect.any(Date) } },
            select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true },
            orderBy: { createdAt: 'desc' },
        });
    });
    it('revokes a single session atomically within the current user', async () => {
        const response = await app.inject({ method: 'DELETE', url: '/other' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true });
        expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: 'other', userId: 'user-1' }, data: { revokedAt: expect.any(Date) } });
    });
    it('returns 404 for absent or foreign sessions without any unscoped update', async () => {
        mocks.updateMany.mockResolvedValue({ count: 0 });
        const response = await app.inject({ method: 'DELETE', url: '/foreign' });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: 'Session not found' });
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign', userId: 'user-1' } }));
    });
    it('excludes the current session from bulk revocation', async () => {
        const response = await app.inject({ method: 'DELETE', url: '/' });
        expect(response.json()).toEqual({ success: true, revokedCount: 1 });
        expect(mocks.updateMany).toHaveBeenCalledWith({ where: { userId: 'user-1', revokedAt: null, id: { not: 'current' } }, data: { revokedAt: expect.any(Date) } });
    });
    it('does not revoke anything when current-session identity is absent', async () => {
        mocks.user = { id: 'user-1' };
        const response = await app.inject({ method: 'DELETE', url: '/' });
        expect(response.statusCode).toBe(400);
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });
    it.each([['GET', '/'], ['DELETE', '/'], ['DELETE', '/other']])('requires user identity for %s %s', async (method, url) => {
        mocks.user = {};
        const response = await app.inject({ method: method as 'GET' | 'DELETE', url });
        expect(response.statusCode).toBe(401);
        expect(mocks.updateMany).not.toHaveBeenCalled();
        expect(mocks.findMany).not.toHaveBeenCalled();
    });
    it('returns a generic error when atomic revocation fails', async () => {
        mocks.updateMany.mockRejectedValue(new Error('Private database error'));
        const response = await app.inject({ method: 'DELETE', url: '/other' });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: 'Failed to revoke session' });
    });
});
