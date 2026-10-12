import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ config: vi.fn(), transport: vi.fn(), send: vi.fn(), close: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { platformCredentials: { findUnique: mocks.config } } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.transport } }));
import { PlatformEmailService } from './PlatformEmailService';

describe('platform email delivery', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.config.mockResolvedValue({ credentials: { host: 'smtp.test', username: 'user', password: 'pass', fromEmail: 'security@test.com' } });
        mocks.transport.mockReturnValue({ sendMail: mocks.send, close: mocks.close });
    });
    it('uses the admin SMTP configuration with bounded connection timeouts', async () => {
        mocks.send.mockResolvedValue({ messageId: 'message' });
        expect(await new PlatformEmailService().sendPlatformEmail('customer@test.com', 'Reset', '<p>Reset</p>')).toMatchObject({ success: true });
        expect(mocks.transport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.test', connectionTimeout: 10_000, socketTimeout: 30_000 }));
        expect(mocks.close).toHaveBeenCalledOnce();
    });
    it('closes failed transports without retrying', async () => {
        mocks.send.mockRejectedValue(new Error('SMTP failed'));
        expect(await new PlatformEmailService().sendPlatformEmail('customer@test.com', 'Reset', '<p>Reset</p>')).toMatchObject({ success: false });
        expect(mocks.close).toHaveBeenCalledOnce();
        expect(mocks.send).toHaveBeenCalledOnce();
    });
    it('does not turn a cleanup error into an apparent send failure', async () => {
        mocks.send.mockResolvedValue({ messageId: 'message' });
        mocks.close.mockImplementation(() => { throw new Error('Close failed'); });
        expect(await new PlatformEmailService().sendPlatformEmail('customer@test.com', 'Reset', '<p>Reset</p>')).toMatchObject({ success: true });
    });
});
