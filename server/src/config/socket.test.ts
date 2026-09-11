import type http from 'node:http';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSocketIO } from './socket';

const mocks = vi.hoisted(() => ({
    use: vi.fn(), adapter: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), verifyToken: vi.fn()
}));
vi.mock('socket.io', () => ({ Server: class { use = mocks.use; adapter = mocks.adapter; } }));
vi.mock('../utils/prisma', () => ({ prisma: {
    user: { findUnique: mocks.findUnique }, accountUser: { findMany: mocks.findMany }
} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/auth', () => ({ verifyToken: mocks.verifyToken }));
vi.mock('../utils/socketAdapter', () => ({ createSocketAdapter: vi.fn() }));
vi.mock('../socket', () => ({ setIO: vi.fn() }));
vi.mock('../services/ChatService', () => ({ ChatService: class {} }));
vi.mock('../routes/chat', () => ({ createChatRoutes: vi.fn() }));
vi.mock('../routes/chat-public', () => ({ createPublicChatRoutes: vi.fn() }));
vi.mock('../routes/sms', () => ({ createSmsRoutes: vi.fn() }));

describe('socket authentication failure isolation', () => {
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.verifyToken.mockReturnValue({ userId: 'user-1' });
        mocks.findUnique.mockResolvedValue({ isSuperAdmin: false });
        mocks.findMany.mockResolvedValue([{ accountId: 'account-1' }]);
        await initializeSocketIO({} as http.Server, { register: vi.fn() } as unknown as FastifyInstance);
    });

    it.each(['findUnique', 'findMany'] as const)('contains rejected Prisma %s and fails authentication closed', async operation => {
        mocks[operation].mockRejectedValue(new Error('Database unavailable'));
        const socket = { id: 'socket-1', data: {}, handshake: { auth: { token: 'token' } } };
        const next = vi.fn();
        await expect(mocks.use.mock.calls[0][0](socket, next)).resolves.toBeUndefined();
        expect(next).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Internal Server Error' }));
        expect(socket.data).toEqual({});
    });

    it.each([undefined, null, {}, { headers: { authorization: [] } }, { auth: null, query: {} }])(
        'contains malformed or missing handshake credentials: %j', async handshake => {
            const next = vi.fn();
            await expect(mocks.use.mock.calls[0][0]({ id: 'socket-1', data: {}, handshake }, next)).resolves.toBeUndefined();
            expect(next).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Unauthorized' }));
            expect(mocks.findUnique).not.toHaveBeenCalled();
        }
    );

    it('does not authorize a requested account outside the user memberships', async () => {
        const socket = { id: 'socket-1', data: {}, handshake: { auth: { token: 'token' }, query: { accountId: 'other' } } };
        const next = vi.fn();
        await mocks.use.mock.calls[0][0](socket, next);
        expect(next).toHaveBeenCalledExactlyOnceWith();
        expect(socket.data).toEqual({ userId: 'user-1', isSuperAdmin: false, accountIds: ['account-1'], requestedAccountId: undefined });
    });
});
