
import { redisClient } from '../utils/redis';
import { Logger } from '../utils/logger';

interface UserInfo {
    userId: string;
    name: string;
    avatarUrl?: string;
    color?: string; // Cursor/Highlight color
    connectedAt: number;
}

const PRESENCE_KEY_PREFIX = 'presence:';
const PRESENCE_TTL_SECONDS = 60; // Auto-expire after 60s if no heartbeat (though we use explicit leave)

export class CollaborationService {

    /**
     * Join a document/resource.
     * Stores user info in a Redis Hash: presence:{docId} -> {socketId: UserInfo}
     */
    static async joinDocument(docId: string, socketId: string, userInfo: UserInfo): Promise<void> {
        const key = `${PRESENCE_KEY_PREFIX}${docId}`;
        try {
            await redisClient.hset(key, socketId, JSON.stringify(userInfo));
            // Set/Refresh TTL on the whole hash to prevent ghosts if server crashes hard
            await redisClient.expire(key, PRESENCE_TTL_SECONDS * 60 * 24); // Actually, we might want long-lived if actively edited. 
            // Better: relying on explicit leave or socket disconnect cleanup. 
            // let's stick to no auto-expire for the hash itself for now, or long expire.
            await redisClient.expire(key, 86400); // 24h safety clear
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
            await redisClient.hdel(key, socketId);
        } catch (error) {
            Logger.error('[CollaborationService] Error leaving document', { error, docId, socketId });
        }
    }

    /**
     * Get current presence list for a document.
     */
    static async getPresence(docId: string): Promise<UserInfo[]> {
        const key = `${PRESENCE_KEY_PREFIX}${docId}`;
        try {
            const values = await redisClient.hvals(key);
            return values.map(v => JSON.parse(v));
        } catch (error) {
            Logger.error('[CollaborationService] Error getting presence', { error, docId });
            return [];
        }
    }

    /**
     * Handle cleanup on socket disconnect.
     * Since we might not know which docs a socket was in easily without a reverse mapping,
     * we should ideally track socket->rooms in memory or Redis.
     * Application level: app.ts knows the rooms the socket is in.
     * We can iterate those rooms.
     */
    static async handleDisconnect(socketId: string, docIds: string[]) {
        for (const docId of docIds) {
            await this.leaveDocument(docId, socketId);
        }
    }
}
