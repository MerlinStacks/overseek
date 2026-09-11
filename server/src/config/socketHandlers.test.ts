import { EventEmitter } from 'node:events';
import type { Server, Socket } from 'socket.io';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupSocketHandlers } from './socketHandlers';
import { safeSocketCallback } from './socketSafety';

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    joinDocument: vi.fn(), leaveDocument: vi.fn(), getPresence: vi.fn(), refreshPresence: vi.fn(),
    error: vi.fn(), warn: vi.fn(), debug: vi.fn()
}));
vi.mock('../utils/prisma', () => ({ prisma: { conversation: { findUnique: mocks.findUnique } } }));
vi.mock('../utils/logger', () => ({ Logger: mocks }));
vi.mock('../services/CollaborationService', () => ({ CollaborationService: mocks }));

function connect(requestedAccountId?: string, rejectJoin = false) {
    const incoming = new EventEmitter();
    const broadcast = { emit: vi.fn() };
    const socket = {
        id: 'socket-1', data: { userId: 'user-1', accountIds: ['account-1'], isSuperAdmin: false, requestedAccountId },
        rooms: new Set(['socket-1', 'conversation:conv-1', 'document:doc-1']),
        on: incoming.on.bind(incoming), emit: vi.fn(), to: vi.fn(() => broadcast),
        join: vi.fn(() => rejectJoin ? Promise.reject(new Error('Adapter unavailable')) : Promise.resolve()),
        leave: vi.fn().mockResolvedValue(undefined)
    };
    const io = new EventEmitter();
    Object.assign(io, { to: vi.fn(() => broadcast) });
    setupSocketHandlers(io as unknown as Server);
    io.emit('connection', socket);
    const invoke = (event: string, ...args: unknown[]) => incoming.listeners(event)[0](...args);
    return { incoming, socket, broadcast, invoke };
}

const validPayloads: [string, unknown][] = [
    ['join:account', 'account-1'],
    ['join:conversation', { conversationId: 'conv-1', user: { id: 'user-1' } }],
    ['leave:conversation', { conversationId: 'conv-1' }],
    ['typing:start', { conversationId: 'conv-1' }],
    ['typing:stop', { conversationId: 'conv-1' }],
    ['agent:draft:start', { conversationId: 'conv-1', user: { id: 'user-1' } }],
    ['agent:draft:stop', { conversationId: 'conv-1', userId: 'user-1' }],
    ['join:document', { docId: 'doc-1', user: {} }],
    ['leave:document', { docId: 'doc-1' }],
    ['presence:heartbeat', { docId: 'doc-1' }]
];

describe('socket failure isolation', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.findUnique.mockResolvedValue({ accountId: 'account-1' });
        mocks.getPresence.mockResolvedValue([]);
    });

    it('contains a rejected Prisma lookup even when the emitter ignores the listener promise', async () => {
        const { incoming, socket } = connect();
        const error = new Error('Prisma connection secret');
        mocks.findUnique.mockRejectedValue(error);
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            incoming.emit('join:conversation', 'conv-1');
            await new Promise(resolve => setImmediate(resolve));
            expect(unhandled).not.toHaveBeenCalled();
            expect(socket.join).not.toHaveBeenCalled();
            expect(socket.emit).toHaveBeenCalledWith('socket:error', {
                event: 'join:conversation', code: 'INTERNAL_ERROR', message: 'Internal Server Error'
            });
            expect(mocks.error).toHaveBeenCalledWith('[Socket] Handler failed', expect.objectContaining({
                socketId: 'socket-1', userId: 'user-1', event: 'join:conversation', error
            }));
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it.each(validPayloads)('acknowledges valid %s without changing its payload contract', async (event, payload) => {
        const { invoke } = connect();
        const ack = vi.fn();
        await expect(invoke(event, payload, ack)).resolves.toBeUndefined();
        expect(ack).toHaveBeenCalledExactlyOnceWith({ ok: true });
    });

    it.each(validPayloads)('rejects malformed %s before any side effects', async (event) => {
        const { invoke, socket, broadcast } = connect();
        for (const payload of [undefined, null, 42, true, [], {}, '', { conversationId: 42, docId: [], user: null }]) {
            const ack = vi.fn();
            await expect(invoke(event, payload, ack)).resolves.toBeUndefined();
            expect(ack).toHaveBeenCalledExactlyOnceWith({ ok: false, error: {
                event, code: 'INVALID_PAYLOAD', message: 'Invalid payload'
            } });
        }
        expect(mocks.findUnique).not.toHaveBeenCalled();
        expect(mocks.joinDocument).not.toHaveBeenCalled();
        expect(mocks.leaveDocument).not.toHaveBeenCalled();
        expect(mocks.refreshPresence).not.toHaveBeenCalled();
        expect(socket.join).not.toHaveBeenCalled();
        expect(socket.leave).not.toHaveBeenCalled();
        expect(broadcast.emit).not.toHaveBeenCalled();
    });

    it.each([
        ['join:conversation', { conversationId: 'conv-1', user: 42 }],
        ['join:document', { docId: 'doc-1', user: null }],
        ['agent:draft:start', { conversationId: 'conv-1', user: { id: [] } }]
    ])('validates nested users for %s', async (event, payload) => {
        const { invoke, socket } = connect();
        await expect(invoke(event as string, payload)).resolves.toBeUndefined();
        expect(socket.emit).toHaveBeenCalledWith('socket:error', expect.objectContaining({ code: 'INVALID_PAYLOAD' }));
        expect(socket.join).not.toHaveBeenCalled();
    });

    it.each(['joinDocument', 'leaveDocument', 'getPresence', 'refreshPresence'] as const)(
        'contains rejected integration operation %s', async operation => {
            mocks[operation].mockRejectedValue(new Error('Redis unavailable'));
            const { invoke } = connect();
            const event = operation === 'joinDocument' ? 'join:document'
                : operation === 'refreshPresence' ? 'presence:heartbeat' : 'leave:document';
            const ack = vi.fn();
            await expect(invoke(event, { docId: 'doc-1', user: {} }, ack)).resolves.toBeUndefined();
            expect(ack).toHaveBeenCalledExactlyOnceWith({ ok: false, error: {
                event, code: 'INTERNAL_ERROR', message: 'Internal Server Error'
            } });
        }
    );

    it('preserves account and conversation authorization and the legacy auth error', async () => {
        const { invoke, socket } = connect();
        mocks.findUnique.mockResolvedValue({ accountId: 'other-account' });
        for (const [event, payload] of [['join:account', 'other-account'], ['join:conversation', 'conv-1']]) {
            const ack = vi.fn();
            await invoke(event, payload, ack);
            expect(ack).toHaveBeenCalledWith({ ok: false, error: { event, code: 'FORBIDDEN', message: 'Forbidden' } });
        }
        expect(socket.join).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith('auth:error', { message: 'Forbidden' });
        socket.data.isSuperAdmin = true;
        mocks.findUnique.mockClear();
        await invoke('join:conversation', 'conv-1');
        expect(mocks.findUnique).not.toHaveBeenCalled();
        expect(socket.join).toHaveBeenCalledWith('conversation:conv-1');
    });

    it('contains room adapter failures, including auto-join', async () => {
        const { invoke } = connect('account-1', true);
        await expect(invoke('join:account', 'account-1')).resolves.toBeUndefined();
        expect(mocks.error).toHaveBeenCalledWith('[Socket] Handler failed', expect.objectContaining({ event: 'connection' }));
    });

    it('preserves presence, typing, and draft broadcast shapes', async () => {
        const { invoke, broadcast } = connect();
        await invoke('join:conversation', { conversationId: 'conv-1', user: { id: 'user-1', name: 'Alex' } });
        expect(mocks.joinDocument).toHaveBeenCalledWith('conv:conv-1', 'socket-1', {
            userId: 'user-1', name: 'Alex', avatarUrl: undefined, connectedAt: expect.any(Number)
        });
        expect(broadcast.emit).toHaveBeenCalledWith('viewers:sync', []);
        await invoke('typing:start', { conversationId: 'conv-1' });
        expect(broadcast.emit).toHaveBeenCalledWith('typing:start', { conversationId: 'conv-1' });
        await invoke('agent:draft:start', { conversationId: 'conv-1', user: { id: 'user-1' } });
        expect(broadcast.emit).toHaveBeenCalledWith('agent:draft:start', {
            conversationId: 'conv-1', user: { id: 'user-1', name: 'Agent', avatarUrl: null }, startedAt: expect.any(Number)
        });
    });

    it('snapshots disconnect rooms before awaiting and contains cleanup rejection', async () => {
        const { invoke, socket } = connect();
        mocks.leaveDocument.mockRejectedValue(new Error('Redis unavailable'));
        const cleanup = invoke('disconnecting', 'transport close');
        socket.rooms.clear();
        await expect(cleanup).resolves.toBeUndefined();
        expect(mocks.leaveDocument).toHaveBeenCalledWith('conv:conv-1', 'socket-1');
        expect(mocks.error).toHaveBeenCalledWith('[Socket] Handler failed', expect.objectContaining({ event: 'disconnecting' }));
        expect(socket.emit).not.toHaveBeenCalled();
    });

    it('contains synchronous throws and failures in logging, transport, and acknowledgements', async () => {
        const { socket } = connect();
        mocks.error.mockImplementation(() => { throw new Error('Logger failed'); });
        socket.emit.mockImplementation(() => { throw new Error('Transport failed'); });
        const handler = safeSocketCallback(socket as unknown as Socket, 'test', (..._args: unknown[]) => { throw new Error('Failed'); });
        await expect(handler()).resolves.toBeUndefined();
        const ack = vi.fn().mockRejectedValue(new Error('Ack failed'));
        await expect(handler({}, ack)).resolves.toBeUndefined();
        expect(ack).toHaveBeenCalledTimes(1);
    });
});
