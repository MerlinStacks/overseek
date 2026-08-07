import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, decryptMock } = vi.hoisted(() => ({
    prismaMock: {
        emailAccount: { findFirst: vi.fn() },
    },
    decryptMock: vi.fn(() => 'stored-secret'),
}));

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});
vi.mock('../../utils/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../middleware/auth', () => ({
    requireAuthFastify: vi.fn(async (request: any) => {
        request.user = { id: 'user-1' };
        request.accountId = request.headers['x-account-id'];
    }),
}));
vi.mock('../../services/PermissionService', () => ({
    PermissionService: { hasPermission: vi.fn() },
}));
vi.mock('../../services/EmailService', () => ({
    EmailService: class { verifyConnection = vi.fn(); },
}));
vi.mock('../../utils/encryption', () => ({
    encrypt: vi.fn((value: string) => value),
    decrypt: decryptMock,
}));

import emailAccountRoutes from './accounts';
import { PermissionService } from '../../services/PermissionService';

describe('email relay test security', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(emailAccountRoutes, { prefix: '/email' });
        await app.ready();
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(async () => {
        await app.close();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('requires account admin permission before testing a relay', async () => {
        vi.mocked(PermissionService.hasPermission).mockResolvedValue(false);

        const response = await injectRelayTest('https://attacker.example/relay');

        expect(response.statusCode).toBe(403);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not decrypt a stored key for a newly supplied endpoint', async () => {
        vi.mocked(PermissionService.hasPermission).mockResolvedValue(true);
        prismaMock.emailAccount.findFirst.mockResolvedValue({
            relayApiKey: 'encrypted-secret',
            relayEndpoint: 'https://relay.example/send',
        });

        const response = await injectRelayTest('https://attacker.example/relay');

        expect(response.statusCode).toBe(400);
        expect(decryptMock).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reuses a stored key only with its saved endpoint', async () => {
        vi.mocked(PermissionService.hasPermission).mockResolvedValue(true);
        prismaMock.emailAccount.findFirst.mockResolvedValue({
            relayApiKey: 'encrypted-secret',
            relayEndpoint: 'https://relay.example/send',
        });
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({}),
        } as any);

        const response = await injectRelayTest('https://relay.example/send');

        expect(response.statusCode).toBe(200);
        expect(decryptMock).toHaveBeenCalledWith('encrypted-secret');
        expect(fetch).toHaveBeenCalledWith('https://relay.example/send', expect.objectContaining({
            redirect: 'error',
            headers: expect.objectContaining({ 'X-Relay-Key': 'stored-secret' }),
        }));
    });

    function injectRelayTest(relayEndpoint: string) {
        return app.inject({
            method: 'POST',
            url: '/email/test-relay',
            headers: { 'x-account-id': 'account-1' },
            payload: {
                relayEndpoint,
                relayApiKey: '••••••••',
                emailAccountId: 'email-account-1',
            },
        });
    }
});
