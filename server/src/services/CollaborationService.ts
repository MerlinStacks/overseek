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
const PRESENCE_TTL_SECONDS = 60; // 60 seconds (aggressive to prevent ghost entries)
/** Timeout for Redis operations to prevent blocking */
const REDIS_OPERATION_TIMEOUT_MS = 5000;
const PRESENCE_MAX_AGE_MS = PRESENCE_TTL_SECONDS * 1000;

// Compare the snapshot atomically: a concurrent heartbeat or rejoin must survive pruning.
const PRUNE_SCRIPT = `
local removed = 0
for i = 1, #ARGV, 2 do
    if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
        removed = removed + redis.call('HDEL', KEYS[1], ARGV[i])
    end
end
return removed`;

// Do not recreate presence after a concurrent leave or overwrite a newer heartbeat.
const REFRESH_SCRIPT = `
if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
    redis.call('EXPIRE', KEYS[1], ARGV[4])
    return 1
end
return 0`;

function parsePresence(value: string): UserInfo | null {
    try {
        const info = JSON.parse(value);
        const lastSeen = info?.lastHeartbeat ?? info?.connectedAt;
        return info && typeof info.userId === 'string' && typeof info.name === 'string' && typeof lastSeen === 'number' && Number.isFinite(lastSeen) ? info : null;
    } catch { return null; }
}

/**
 * Wraps a promise with a timeout to prevent indefinite blocking.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    // Why .finally: if the real promise wins the race the setTimeout handle
    // would otherwise leak until natural expiry — thousands of orphaned timers
    // under concurrent load.
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer!));
}

export class CollaborationService {

    /**
     * Join a document/resource.
     * Stores user info in a Redis Hash: presence:{docId} -> {socketId: UserInfo}
     * 
     * EDGE CASE FIX: Prunes stale entries on join to prevent ghost presence after reconnects.
     */
    static async joinDocument(docId: string, socketId: string, userInfo: UserInfo): Promise<void> {
        const key = `${PRESENCE_KEY_PREFIX}${docId}`;
        try {
            // Prune stale entries first to prevent ghost presence after reconnects
            await this.pruneStale(docId, PRESENCE_MAX_AGE_MS);

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
                const userInfo = parsePresence(existing);
                if (!userInfo) return;
                userInfo.lastHeartbeat = Date.now();
                await withTimeout(
                    redisClient.eval(REFRESH_SCRIPT, 1, key, socketId, existing, JSON.stringify(userInfo), PRESENCE_TTL_SECONDS),
                    REDIS_OPERATION_TIMEOUT_MS,
                    'refreshPresence:set'
                );
            }
            await this.pruneStale(docId, PRESENCE_MAX_AGE_MS);
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
            const maxAge = pruneStaleMs ?? PRESENCE_MAX_AGE_MS;
            await this.pruneStale(docId, maxAge);

            const values = await withTimeout(
                redisClient.hvals(key),
                REDIS_OPERATION_TIMEOUT_MS,
                'getPresence'
            );
            return values.flatMap(value => {
                const info = parsePresence(value);
                return info && Date.now() - (info.lastHeartbeat ?? info.connectedAt) <= maxAge ? [info] : [];
            });
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
        if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error('Invalid presence age');
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

            const staleEntries: string[] = [];
            for (const [socketId, value] of Object.entries(entries)) {
                const info = parsePresence(value);
                if (!info || now - (info.lastHeartbeat ?? info.connectedAt) > maxAgeMs) staleEntries.push(socketId, value);
            }

            if (staleEntries.length > 0) {
                const removed = await withTimeout(
                    redisClient.eval(PRUNE_SCRIPT, 1, key, ...staleEntries),
                    REDIS_OPERATION_TIMEOUT_MS,
                    'pruneStale:hdel'
                );
                prunedCount = Number(removed);
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
