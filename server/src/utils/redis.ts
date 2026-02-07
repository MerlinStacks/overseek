import Redis, { RedisOptions } from 'ioredis';
import { Logger } from './logger';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);


const baseOptions: RedisOptions = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null,    // required by BullMQ
    enableReadyCheck: true,
    retryStrategy: (times) => {
        // exponential backoff, max 30s
        const delay = Math.min(times * 50, 30000);
        // avoid log spam
        if (times <= 3 || times % 10 === 0) {
            Logger.warn(`Redis retry attempt ${times}, next retry in ${delay}ms`);
        }
        return delay;
    },
    reconnectOnError: (err) => {

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

    /** separate connection for BullMQ workers (they block) */
    public static createWorkerConnection(): Redis {
        const workerConn = new Redis({
            ...baseOptions,
            lazyConnect: true,
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

