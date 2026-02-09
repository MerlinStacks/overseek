

import { redisClient } from './redis';
import { Logger } from './logger';


const DEFAULT_TTL = 300;


const CACHE_PREFIX = 'cache:';

const MAX_SAFE_CACHE_SIZE = 10 * 1024 * 1024; // 10MB - larger values can OOM during JSON.parse


export interface CacheOptions {
    /** Time-to-live in seconds */
    ttl?: number;
    /** Namespace for the cache key */
    namespace?: string;
}


function buildKey(key: string, namespace?: string): string {
    const ns = namespace ? `${namespace}:` : '';
    return `${CACHE_PREFIX}${ns}${key}`;
}


export async function cacheGet<T>(key: string, options?: CacheOptions): Promise<T | null> {
    const fullKey = buildKey(key, options?.namespace);

    try {
        const cached = await redisClient.get(fullKey);
        if (cached) {
            // guard against huge payloads that could OOM during parse
            if (cached.length > MAX_SAFE_CACHE_SIZE) {
                Logger.error('[Cache] DANGEROUS: Cached value exceeds safe size limit', {
                    key: fullKey,
                    sizeBytes: cached.length,
                    sizeMB: (cached.length / 1024 / 1024).toFixed(2),
                    limitMB: (MAX_SAFE_CACHE_SIZE / 1024 / 1024).toFixed(0)
                });

                await redisClient.del(fullKey);
                return null;
            }
            return JSON.parse(cached) as T;
        }
        return null;
    } catch (error) {
        Logger.debug('[Cache] Get failed', { key: fullKey, error });
        return null;
    }
}


export async function cacheSet<T>(
    key: string,
    value: T,
    options?: CacheOptions
): Promise<void> {
    const fullKey = buildKey(key, options?.namespace);
    const ttl = options?.ttl ?? DEFAULT_TTL;

    try {
        await redisClient.setex(fullKey, ttl, JSON.stringify(value));
    } catch (error) {
        Logger.debug('[Cache] Set failed', { key: fullKey, error });
    }
}


export async function cacheDelete(key: string, options?: CacheOptions): Promise<void> {
    const fullKey = buildKey(key, options?.namespace);

    try {
        await redisClient.del(fullKey);
    } catch (error) {
        Logger.debug('[Cache] Delete failed', { key: fullKey, error });
    }
}

/** delete all keys matching a pattern. uses SCAN to avoid blocking. */
export async function cacheDeletePattern(pattern: string, namespace?: string): Promise<number> {
    const fullPattern = buildKey(pattern, namespace);
    let deleted = 0;
    let cursor = '0';

    try {
        do {
            const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
                await redisClient.del(...keys);
                deleted += keys.length;
            }
        } while (cursor !== '0');

        if (deleted > 0) {
            Logger.debug('[Cache] Pattern delete completed', { pattern: fullPattern, deleted });
        }
        return deleted;
    } catch (error) {
        Logger.debug('[Cache] Pattern delete failed', { pattern: fullPattern, error });
        return 0;
    }
}

/**
 * get-or-set: try cache first, otherwise fetch and cache the result.
 *
 * @example
 * const products = await cacheAside(
 *   `products:${accountId}`,
 *   async () => await prisma.wooProduct.findMany({ where: { accountId } }),
 *   { ttl: 60, namespace: 'api' }
 * );
 */
export async function cacheAside<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options?: CacheOptions
): Promise<T> {

    const cached = await cacheGet<T>(key, options);
    if (cached !== null) {
        return cached;
    }


    const result = await fetchFn();
    await cacheSet(key, result, options);

    return result;
}


export async function invalidateCache(namespace: string, entityId?: string): Promise<void> {
    const pattern = entityId ? `${entityId}*` : '*';
    const deleted = await cacheDeletePattern(pattern, namespace);
    if (deleted > 0) {
        Logger.info('[Cache] Invalidated', { namespace, entityId, count: deleted });
    }
}

export const CacheTTL = {
    /** 30s - fast-changing data */
    SHORT: 30,
    /** 2m - dashboard widgets */
    DASHBOARD: 120,
    /** 5m - default */
    MEDIUM: 300,
    /** 30m */
    LONG: 1800,
    /** 1h */
    HOUR: 3600,
    /** 24h */
    DAY: 86400,
} as const;

export const CacheNamespace = {
    ANALYTICS: 'analytics',
    PRODUCTS: 'products',
    CUSTOMERS: 'customers',
    ORDERS: 'orders',
    DASHBOARD: 'dashboard',
    SESSIONS: 'sessions',
    INBOX: 'inbox',
} as const;
