

import { createAdapter } from '@socket.io/redis-adapter';
import { redisClient } from './redis';
import { Logger } from './logger';

/** redis pub/sub adapter for multi-instance socket.io */
export function createSocketAdapter() {
    Logger.info('[Socket] Creating Redis adapter for horizontal scaling');

    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();

    return createAdapter(pubClient, subClient);
}
