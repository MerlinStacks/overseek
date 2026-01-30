/**
 * Socket.IO Redis Adapter
 * 
 * Enables Socket.IO to work across multiple server instances
 * by using Redis pub/sub for message distribution.
 */

import { createAdapter } from '@socket.io/redis-adapter';
import { redisClient } from './redis';
import { Logger } from './logger';

/**
 * Creates a Socket.IO Redis adapter for horizontal scaling.
 * Both pub and sub clients are duplicates of the main Redis connection.
 */
export function createSocketAdapter() {
    Logger.info('[Socket] Creating Redis adapter for horizontal scaling');

    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();

    return createAdapter(pubClient, subClient);
}
