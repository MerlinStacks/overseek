import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUser: vi.fn(), update: vi.fn(), send: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { user: { findUnique: mocks.findUser, update: mocks.update } } }));
vi.mock('../services/PlatformEmailService', () => ({ platformEmailService: { sendPlatformEmail: mocks.send } }));
vi.mock('../services/SecurityService', () => ({ SecurityService: {} }));
vi.mock('../services/PermissionService', () => ({ PermissionService: {} }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: vi.fn() }));
vi.mock('../utils/auth', () => ({ hashPassword: vi.fn(), comparePassword: vi.fn() }));
vi.mock('../utils/redis', () => ({ redisClient: {} }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import authRoutes from './auth';

describe('password reset email', () => {
    const apps: ReturnType<typeof Fastify>[] = [];
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('SMTP_HOST', '');
        mocks.findUser.mockResolvedValue({ id: 'user', email: 'user@example.com' });
        mocks.send.mockResolvedValue({ success: true });
    });
    afterEach(async () => {
        await Promise.all(apps.splice(0).map(app => app.close()));
        vi.unstubAllEnvs();
    });
    it('uses platform SMTP even without environment SMTP settings', async () => {
        const app = Fastify();
        apps.push(app);
        await app.register(authRoutes);
        const response = await app.inject({ method: 'POST', url: '/forgot-password', payload: { email: 'user@example.com' } });
        expect(response.statusCode).toBe(200);
        expect(mocks.send).toHaveBeenCalledWith('user@example.com', 'Password Reset Request', expect.stringContaining('/reset-password?token='), {
            textContent: expect.stringContaining('/reset-password?token=')
        });
        expect(mocks.update.mock.calls[0][0].data.resetToken).toMatch(/^[a-f0-9]{64}$/);
    });
    it('keeps the same public response on delivery failure', async () => {
        mocks.send.mockResolvedValue({ success: false, error: 'SMTP unavailable' });
        const app = Fastify();
        apps.push(app);
        await app.register(authRoutes);
        const response = await app.inject({ method: 'POST', url: '/forgot-password', payload: { email: 'user@example.com' } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ message: 'If an account exists, a reset link has been sent.' });
    });
});
