/**
 * Unit tests for CollaborationService.
 * 
 * Tests presence tracking, heartbeat refresh, and stale entry pruning.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock must use inline factory functions (no external references)
vi.mock('../../utils/redis', () => ({
    redisClient: {
        hset: vi.fn().mockResolvedValue(1),
        hdel: vi.fn().mockResolvedValue(1),
        hget: vi.fn().mockResolvedValue(null),
        hvals: vi.fn().mockResolvedValue([]),
        hgetall: vi.fn().mockResolvedValue({}),
        expire: vi.fn().mockResolvedValue(1),
    },
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Import after mocks are set up
import { CollaborationService } from '../CollaborationService';
import { redisClient } from '../../utils/redis';

// Cast to get mock methods
const mockRedis = redisClient as unknown as {
    hset: ReturnType<typeof vi.fn>;
    hdel: ReturnType<typeof vi.fn>;
    hget: ReturnType<typeof vi.fn>;
    hvals: ReturnType<typeof vi.fn>;
    hgetall: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
};

describe('CollaborationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('joinDocument', () => {
        it('should store user presence in Redis hash', async () => {
            const userInfo = {
                userId: 'user-123',
                name: 'Test User',
                connectedAt: Date.now(),
            };

            await CollaborationService.joinDocument('doc-1', 'socket-abc', userInfo);

            expect(mockRedis.hset).toHaveBeenCalledWith(
                'presence:doc-1',
                'socket-abc',
                expect.stringContaining('"userId":"user-123"')
            );
            expect(mockRedis.expire).toHaveBeenCalledWith('presence:doc-1', 120);
        });

        it('should add lastHeartbeat timestamp to user info', async () => {
            const userInfo = {
                userId: 'user-123',
                name: 'Test User',
                connectedAt: 1000,
            };

            await CollaborationService.joinDocument('doc-1', 'socket-abc', userInfo);

            const storedData = JSON.parse(mockRedis.hset.mock.calls[0][2]);
            expect(storedData.lastHeartbeat).toBeDefined();
            expect(typeof storedData.lastHeartbeat).toBe('number');
        });
    });

    describe('leaveDocument', () => {
        it('should remove user from Redis hash', async () => {
            await CollaborationService.leaveDocument('doc-1', 'socket-abc');

            expect(mockRedis.hdel).toHaveBeenCalledWith('presence:doc-1', 'socket-abc');
        });
    });

    describe('getPresence', () => {
        it('should return parsed presence list', async () => {
            const user1 = JSON.stringify({ userId: 'u1', name: 'User 1', connectedAt: 1000 });
            const user2 = JSON.stringify({ userId: 'u2', name: 'User 2', connectedAt: 2000 });
            mockRedis.hvals.mockResolvedValueOnce([user1, user2]);

            const result = await CollaborationService.getPresence('doc-1');

            expect(result).toHaveLength(2);
            expect(result[0].userId).toBe('u1');
            expect(result[1].userId).toBe('u2');
        });

        it('should return empty array on error', async () => {
            mockRedis.hvals.mockRejectedValueOnce(new Error('Redis error'));

            const result = await CollaborationService.getPresence('doc-1');

            expect(result).toEqual([]);
        });
    });

    describe('refreshPresence', () => {
        it('should update lastHeartbeat for existing user', async () => {
            const existingUser = JSON.stringify({
                userId: 'u1',
                name: 'User 1',
                connectedAt: 1000,
                lastHeartbeat: 1000,
            });
            mockRedis.hget.mockResolvedValueOnce(existingUser);

            await CollaborationService.refreshPresence('doc-1', 'socket-abc');

            expect(mockRedis.hget).toHaveBeenCalledWith('presence:doc-1', 'socket-abc');
            expect(mockRedis.hset).toHaveBeenCalled();

            const updatedData = JSON.parse(mockRedis.hset.mock.calls[0][2]);
            expect(updatedData.lastHeartbeat).toBeGreaterThan(1000);
        });

        it('should do nothing if user not found', async () => {
            mockRedis.hget.mockResolvedValueOnce(null);

            await CollaborationService.refreshPresence('doc-1', 'socket-abc');

            expect(mockRedis.hset).not.toHaveBeenCalled();
        });
    });

    describe('pruneStale', () => {
        it('should remove entries older than maxAgeMs', async () => {
            const now = Date.now();
            const staleUser = JSON.stringify({
                userId: 'stale',
                name: 'Stale User',
                connectedAt: now - 300000, // 5 minutes ago
                lastHeartbeat: now - 300000,
            });
            const activeUser = JSON.stringify({
                userId: 'active',
                name: 'Active User',
                connectedAt: now - 10000, // 10 seconds ago
                lastHeartbeat: now - 10000,
            });

            mockRedis.hgetall.mockResolvedValueOnce({
                'socket-stale': staleUser,
                'socket-active': activeUser,
            });

            const pruned = await CollaborationService.pruneStale('doc-1', 120000); // 2 min threshold

            expect(pruned).toBe(1);
            expect(mockRedis.hdel).toHaveBeenCalledWith('presence:doc-1', 'socket-stale');
        });

        it('should return 0 if no stale entries', async () => {
            const now = Date.now();
            const activeUser = JSON.stringify({
                userId: 'active',
                name: 'Active User',
                connectedAt: now - 10000,
                lastHeartbeat: now - 10000,
            });

            mockRedis.hgetall.mockResolvedValueOnce({
                'socket-active': activeUser,
            });

            const pruned = await CollaborationService.pruneStale('doc-1', 120000);

            expect(pruned).toBe(0);
            expect(mockRedis.hdel).not.toHaveBeenCalled();
        });
    });

    describe('handleDisconnect', () => {
        it('should leave all provided document IDs', async () => {
            await CollaborationService.handleDisconnect('socket-abc', ['doc-1', 'doc-2', 'doc-3']);

            expect(mockRedis.hdel).toHaveBeenCalledTimes(3);
            expect(mockRedis.hdel).toHaveBeenCalledWith('presence:doc-1', 'socket-abc');
            expect(mockRedis.hdel).toHaveBeenCalledWith('presence:doc-2', 'socket-abc');
            expect(mockRedis.hdel).toHaveBeenCalledWith('presence:doc-3', 'socket-abc');
        });
    });
});
