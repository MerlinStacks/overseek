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
        if (times === 5 || times % 10 === 0) {
            Logger.warn(`Redis retry attempt ${times}, next retry in ${delay}ms`);
        }
        return delay;
    },
    reconnectOnError: (err) => {
        // EAI_AGAIN = transient DNS failure; reconnect instead of surfacing.
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'];
        return targetErrors.some(e => err.message.includes(e));
    },
};

/**
 * Attach a default `error` listener. An unhandled `error` event on an
 * EventEmitter crashes Node; ioredis would otherwise log "missing 'error'
 * handler on this Redis client" and the process could exit under DNS / network
 * flaps (EAI_AGAIN).
 */
function attachErrorHandler(client: Redis, label: string): Redis {
    client.on('error', (err) => {
        Logger.error(`Redis ${label} Error`, { error: err.message });
    });
    return client;
}

/**
 * Patch `duplicate()` so that any clone BullMQ creates internally (for its
 * subscriber / blocking connections) inherits an error handler. Without this,
 * ioredis warns "missing 'error' handler on this Redis client" every time the
 * duplicate sees a DNS blip, and an unhandled 'error' can kill the worker.
 */
function patchDuplicate(client: Redis, label: string): Redis {
    const originalDuplicate = client.duplicate.bind(client);
    (client as any).duplicate = (override?: Partial<RedisOptions>) => {
        const dup = originalDuplicate(override);
        attachErrorHandler(dup, `${label} (duplicate)`);
        // Recurse so BullMQ can keep duplicating safely.
        patchDuplicate(dup, `${label} (duplicate)`);
        return dup;
    };
    return client;
}

class RedisConnection {
    private static instance: Redis;

    public static getInstance(): Redis {
        if (!RedisConnection.instance) {
            Logger.info('Initializing Redis Connection...');
            RedisConnection.instance = new Redis(baseOptions);

            RedisConnection.instance.on('connect', () => {
                Logger.info('Redis Connected Successfully');
            });

            attachErrorHandler(RedisConnection.instance, 'Connection');
            patchDuplicate(RedisConnection.instance, 'Connection');

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

        attachErrorHandler(workerConn, 'Worker Connection');
        patchDuplicate(workerConn, 'Worker Connection');

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

