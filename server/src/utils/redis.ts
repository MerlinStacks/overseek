import Redis, { RedisOptions } from 'ioredis';
import { Logger } from './logger';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

/**
 * Base Redis connection options optimized for BullMQ and high availability
 */
const baseOptions: RedisOptions = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null,    // Required for BullMQ blocking commands
    enableReadyCheck: true,        // Verify connection before use
    retryStrategy: (times) => {
        // Exponential backoff: 50ms, 100ms, 200ms... max 30s
        const delay = Math.min(times * 50, 30000);
        Logger.warn(`Redis retry attempt ${times}, next retry in ${delay}ms`);
        return delay;
    },
    reconnectOnError: (err) => {
        // Reconnect on specific errors
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        return targetErrors.some(e => err.message.includes(e));
    },
};

class RedisConnection {
    private static instance: Redis;

    public static getInstance(): Redis {
        if (!RedisConnection.instance) {
            Logger.info('Initializing Redis Connection...');
            RedisConnection.instance = new Redis(baseOptions);

            RedisConnection.instance.on('connect', () => {
                Logger.info('Redis Connected Successfully');
            });

            RedisConnection.instance.on('error', (err) => {
                Logger.error('Redis Connection Error', { error: err.message });
            });

            RedisConnection.instance.on('reconnecting', () => {
                Logger.warn('Redis Reconnecting...');
            });
        }

        return RedisConnection.instance;
    }

    /**
     * Create a dedicated connection for BullMQ workers.
     * Workers require separate connections due to blocking operations.
     */
    public static createWorkerConnection(): Redis {
        const workerConn = new Redis({
            ...baseOptions,
            lazyConnect: true,  // Connect on first command
        });

        workerConn.on('error', (err) => {
            Logger.error('Redis Worker Connection Error', { error: err.message });
        });

        return workerConn;
    }

    public static async close(): Promise<void> {
        if (RedisConnection.instance) {
            await RedisConnection.instance.quit();
            Logger.info('Redis Connection Closed');
        }
    }
}

export const redisClient = RedisConnection.getInstance();
export const createWorkerConnection = RedisConnection.createWorkerConnection;

