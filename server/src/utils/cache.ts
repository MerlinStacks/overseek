/**
 * Redis Caching Layer
 * 
 * Provides a simple, type-safe caching abstraction with:
 * - TTL-based expiration
 * - Cache-aside pattern (get-or-set)
 * - Namespace prefixing to avoid collisions
 * - JSON serialization for complex objects
 */

import { redisClient } from './redis';
import { Logger } from './logger';

/** Default TTL in seconds (5 minutes) */
const DEFAULT_TTL = 300;

/** Cache key prefix to namespace all cache entries */
const CACHE_PREFIX = 'cache:';

/** Maximum safe cache value size (10MB) - larger values may cause OOM during JSON.parse */
const MAX_SAFE_CACHE_SIZE = 10 * 1024 * 1024;

/**
 * Cache configuration options
 */
export interface CacheOptions {
    /** Time-to-live in seconds */
    ttl?: number;
    /** Namespace for the cache key */
    namespace?: string;
}

/**
 * Build a namespaced cache key
 */
function buildKey(key: string, namespace?: string): string {
    const ns = namespace ? `${namespace}:` : '';
    return `${CACHE_PREFIX}${ns}${key}`;
}

/**
 * Get a value from cache.
 * Returns null if not found or expired.
 */
export async function cacheGet<T>(key: string, options?: CacheOptions): Promise<T | null> {
    const fullKey = buildKey(key, options?.namespace);

    try {
        const cached = await redisClient.get(fullKey);
        if (cached) {
            // Guard against massive payloads that could OOM during JSON.parse
            if (cached.length > MAX_SAFE_CACHE_SIZE) {
                Logger.error('[Cache] DANGEROUS: Cached value exceeds safe size limit', {
                    key: fullKey,
                    sizeBytes: cached.length,
                    sizeMB: (cached.length / 1024 / 1024).toFixed(2),
                    limitMB: (MAX_SAFE_CACHE_SIZE / 1024 / 1024).toFixed(0)
                });
                // Delete the corrupted/oversized entry and return null
                await redisClient.del(fullKey);
                return null;
            }
            return JSON.parse(cached) as T;
        }
        return null;
    } catch (error) {
        Logger.warn('[Cache] Get failed', { key: fullKey, error });
        return null;
    }
}

/**
 * Set a value in cache with TTL.
 */
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
        Logger.warn('[Cache] Set failed', { key: fullKey, error });
    }
}

/**
 * Delete a value from cache.
 */
export async function cacheDelete(key: string, options?: CacheOptions): Promise<void> {
    const fullKey = buildKey(key, options?.namespace);

    try {
        await redisClient.del(fullKey);
    } catch (error) {
        Logger.warn('[Cache] Delete failed', { key: fullKey, error });
    }
}

/**
 * Delete all cached values matching a pattern.
 * Uses SCAN for non-blocking iteration (safe for large datasets).
 */
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
        Logger.warn('[Cache] Pattern delete failed', { pattern: fullPattern, error });
        return 0;
    }
}

/**
 * Cache-aside pattern: Get from cache, or execute function and cache result.
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
    // Try cache first
    const cached = await cacheGet<T>(key, options);
    if (cached !== null) {
        return cached;
    }

    // Cache miss - fetch and store
    const result = await fetchFn();
    await cacheSet(key, result, options);

    return result;
}

/**
 * Invalidate cache for a specific entity.
 * Use after mutations to ensure fresh data.
 */
export async function invalidateCache(namespace: string, entityId?: string): Promise<void> {
    const pattern = entityId ? `${entityId}*` : '*';
    const deleted = await cacheDeletePattern(pattern, namespace);
    if (deleted > 0) {
        Logger.info('[Cache] Invalidated', { namespace, entityId, count: deleted });
    }
}

// --- Convenience exports for common TTLs ---

export const CacheTTL = {
    /** 30 seconds - for frequently changing data */
    SHORT: 30,
    /** 2 minutes - for dashboard widgets on large accounts */
    DASHBOARD: 120,
    /** 5 minutes - default for most queries */
    MEDIUM: 300,
    /** 30 minutes - for stable data */
    LONG: 1800,
    /** 1 hour - for rarely changing data */
    HOUR: 3600,
    /** 24 hours - for static data */
    DAY: 86400,
} as const;

// --- Common cache namespaces ---

export const CacheNamespace = {
    ANALYTICS: 'analytics',
    PRODUCTS: 'products',
    CUSTOMERS: 'customers',
    ORDERS: 'orders',
    DASHBOARD: 'dashboard',
    SESSIONS: 'sessions',
    INBOX: 'inbox',
} as const;
