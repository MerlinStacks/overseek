

import { createAdapter } from '@socket.io/redis-adapter';
import { redisClient } from './redis';
import { Logger } from './logger';
import { onShutdown } from './shutdown';
import type Redis from 'ioredis';

/** redis pub/sub adapter for multi-instance socket.io */
export function createSocketAdapter() {
    Logger.info('[Socket] Creating Redis adapter for horizontal scaling');

    const clients: Redis[] = [];
    try {
        // Pub/sub connections, unlike API commands, must survive reconnects.
        const options = { maxRetriesPerRequest: null, commandTimeout: undefined, enableOfflineQueue: true };
        clients.push(redisClient.duplicate(options));
        clients.push(redisClient.duplicate(options));
        const adapter = createAdapter(clients[0], clients[1]);
        let disposed = false;
        const dispose = async () => {
            if (disposed) return;
            disposed = true;
            const results = await Promise.allSettled(clients.map(async client => {
                try { if (client.status === 'ready') await client.quit(); } finally { client.disconnect(); }
            }));
            if (results.some(result => result.status === 'rejected')) throw new Error('Socket adapter Redis cleanup failed');
        };
        onShutdown(dispose, 'resources');
        return Object.assign(adapter, { dispose });
    } catch (error) {
        for (const client of clients) client.disconnect();
        throw error;
    }
}
