/**
 * CollaborationService - Real-time presence tracking for collaborative editing.
 * 
 * Uses Redis Hash to track which users are viewing each document/resource.
 * Implements heartbeat-based TTL to auto-evict stale entries from crashed clients.
 */

import { redisClient } from '../utils/redis';
import { Logger } from '../utils/logger';

interface UserInfo {
    userId: string;
    name: string;
    avatarUrl?: string;
    color?: string;
    connectedAt: number;
    lastHeartbeat?: number;
}

const PRESENCE_KEY_PREFIX = 'presence:';
/** TTL for presence entries - if no heartbeat received, entry expires */
const PRESENCE_TTL_SECONDS = 120; // 2 minutes
/** Timeout for Redis operations to prevent blocking */
const REDIS_OPERATION_TIMEOUT_MS = 5000;

/**
 * Wraps a promise with a timeout to prevent indefinite blocking.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
}

export class CollaborationService {

    /**
     * Join a document/resource.
     * Stores user info in a Redis Hash: presence:{docId} -> {socketId: UserInfo}
     */
    static async joinDocument(docId: string, socketId: string, userInfo: UserInfo): Promise<void> {
        const key = `${PRESENCE_KEY_PREFIX}${docId}`;
        try {
            const infoWithHeartbeat = {
                ...userInfo,
                lastHeartbeat: Date.now()
            };
            await withTimeout(
                redisClient.hset(key, socketId, JSON.stringify(infoWithHeartbeat)),
                REDIS_OPERATION_TIMEOUT_MS,
                'joinDocument'
            );
            // Short TTL - entries auto-expire if no heartbeat refreshes them
            await withTimeout(
                redisClient.expire(key, PRESENCE_TTL_SECONDS),
                REDIS_OPERATION_TIMEOUT_MS,
                'joinDocument:expire'
            );
        } catch (error) {
            Logger.error('[CollaborationService] Error joining document', { error, docId, socketId });
        }
    }

    /**
     * Leave a document.
     * Removes the field from the Redis Hash.
     */
    static async leaveDocument(docId: string, socketId: string): Promise<void> {
        const key = `${PRESENCE_KEY_PREFIX}${docId}`;
        try {
            await withTimeout(
                redisClient.hdel(key, socketId),
                REDIS_OPERATION_TIMEOUT_MS,
                'leaveDocument'
            );
        } catch (error) {
            Logger.error('[CollaborationService] Error leaving document', { error, docId, socketId });
        }
    }

    /**
     * Refresh presence heartbeat for a socket.
     * Called periodically by clients to indicate they're still active.
     */
    static async refreshPresence(docId: string, socketId: string): Promise<void> {
        const key = `${PRESENCE_KEY_PREFIX}${docId}`;
        try {
            const existing = await withTimeout(
                redisClient.hget(key, socketId),
                REDIS_OPERATION_TIMEOUT_MS,
                'refreshPresence:get'
            );
            if (existing) {
                const userInfo = JSON.parse(existing) as UserInfo;
                userInfo.lastHeartbeat = Date.now();
                await withTimeout(
                    redisClient.hset(key, socketId, JSON.stringify(userInfo)),
                    REDIS_OPERATION_TIMEOUT_MS,
                    'refreshPresence:set'
                );
                // Refresh the key TTL
                await withTimeout(
                    redisClient.expire(key, PRESENCE_TTL_SECONDS),
                    REDIS_OPERATION_TIMEOUT_MS,
                    'refreshPresence:expire'
                );
            }
        } catch (error) {
            Logger.error('[CollaborationService] Error refreshing presence', { error, docId, socketId });
        }
    }

    /**
     * Get current presence list for a document.
     * Optionally prunes stale entries before returning.
     */
    static async getPresence(docId: string, pruneStaleMs?: number): Promise<UserInfo[]> {
        const key = `${PRESENCE_KEY_PREFIX}${docId}`;
        try {
            // Optionally prune stale entries first
            if (pruneStaleMs) {
                await this.pruneStale(docId, pruneStaleMs);
            }

            const values = await withTimeout(
                redisClient.hvals(key),
                REDIS_OPERATION_TIMEOUT_MS,
                'getPresence'
            );
            return values.map(v => JSON.parse(v));
        } catch (error) {
            Logger.error('[CollaborationService] Error getting presence', { error, docId });
            return [];
        }
    }

    /**
     * Remove entries with lastHeartbeat older than maxAgeMs.
     * Protects against zombie entries from crashed clients.
     */
    static async pruneStale(docId: string, maxAgeMs: number): Promise<number> {
        const key = `${PRESENCE_KEY_PREFIX}${docId}`;
        const now = Date.now();
        let prunedCount = 0;

        try {
            const entries = await withTimeout(
                redisClient.hgetall(key),
                REDIS_OPERATION_TIMEOUT_MS,
                'pruneStale:getall'
            );

            if (!entries) return 0;

            const staleSocketIds: string[] = [];
            for (const [socketId, value] of Object.entries(entries)) {
                try {
                    const userInfo = JSON.parse(value) as UserInfo;
                    const lastSeen = userInfo.lastHeartbeat || userInfo.connectedAt;
                    if (now - lastSeen > maxAgeMs) {
                        staleSocketIds.push(socketId);
                    }
                } catch {
                    // Malformed entry, mark for removal
                    staleSocketIds.push(socketId);
                }
            }

            if (staleSocketIds.length > 0) {
                await withTimeout(
                    redisClient.hdel(key, ...staleSocketIds),
                    REDIS_OPERATION_TIMEOUT_MS,
                    'pruneStale:hdel'
                );
                prunedCount = staleSocketIds.length;
                Logger.debug('[CollaborationService] Pruned stale entries', { docId, count: prunedCount });
            }
        } catch (error) {
            Logger.error('[CollaborationService] Error pruning stale entries', { error, docId });
        }

        return prunedCount;
    }

    /**
     * Handle cleanup on socket disconnect.
     * Called with the list of document IDs the socket was in.
     */
    static async handleDisconnect(socketId: string, docIds: string[]) {
        for (const docId of docIds) {
            await this.leaveDocument(docId, socketId);
        }
    }
}
