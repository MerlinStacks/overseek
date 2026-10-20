/**
 * Cache Utility Tests
 * 
 * Tests the caching layer functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Redis client
const mockRedisClient = vi.hoisted(() => ({
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    scan: vi.fn(),
}));

vi.mock('../../utils/redis', () => ({
    redisClient: mockRedisClient
}));

vi.mock('../logger', () => ({
    Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

// Import after mocking
import { cacheGet, cacheSet, cacheDelete, cacheDeletePattern, cacheAside, invalidateCache, CacheTTL, CacheNamespace } from '../cache';

const MAX_CACHE_SIZE = 10 * 1024 * 1024;

describe('Cache Utilities', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockRedisClient.get.mockResolvedValue(null);
        mockRedisClient.setex.mockResolvedValue('OK');
        mockRedisClient.del.mockResolvedValue(1);
        mockRedisClient.scan.mockResolvedValue(['0', []]);
    });

    describe('cacheGet', () => {
        it('returns null rather than throwing when Redis is unavailable', async () => {
            mockRedisClient.get.mockRejectedValue(new Error('Redis unavailable'));
            await expect(cacheGet('key')).resolves.toBeNull();
        });

        it('treats malformed JSON as a cache miss', async () => {
            mockRedisClient.get.mockResolvedValue('{broken');
            await expect(cacheGet('key')).resolves.toBeNull();
            expect(mockRedisClient.del).toHaveBeenCalledWith('cache:key');
        });
        it('enforces the limit in UTF-8 bytes, not UTF-16 code units', async () => {
            mockRedisClient.get.mockResolvedValue(JSON.stringify('界'.repeat(4 * 1024 * 1024)));
            expect(await cacheGet('unicode')).toBeNull(); expect(mockRedisClient.del).toHaveBeenCalledWith('cache:unicode');
        });

        it.each([false, 0, '', [], {}])('preserves cached falsey or empty values: %j', async value => {
            mockRedisClient.get.mockResolvedValue(JSON.stringify(value));
            await expect(cacheGet('key')).resolves.toEqual(value);
        });

        it('evicts oversized data using the namespaced key', async () => {
            mockRedisClient.get.mockResolvedValue('x'.repeat(MAX_CACHE_SIZE + 1));
            await expect(cacheGet('key', { namespace: 'products' })).resolves.toBeNull();
            expect(mockRedisClient.del).toHaveBeenCalledExactlyOnceWith('cache:products:key');
        });

        it('still returns null when eviction of oversized data fails', async () => {
            mockRedisClient.get.mockResolvedValue('x'.repeat(MAX_CACHE_SIZE + 1));
            mockRedisClient.del.mockRejectedValue(new Error('Delete failed'));
            await expect(cacheGet('key')).resolves.toBeNull();
        });

        it('accepts valid JSON exactly at the size limit without evicting it', async () => {
            const value = 'x'.repeat(MAX_CACHE_SIZE - 2); // Include the JSON string's quotes.
            mockRedisClient.get.mockResolvedValue(JSON.stringify(value));
            expect(await cacheGet('key')).toBe(value);
            expect(mockRedisClient.del).not.toHaveBeenCalled();
        });

        it('should return parsed JSON when cache hit', async () => {
            mockRedisClient.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));

            const result = await cacheGet('testKey');

            expect(result).toEqual({ foo: 'bar' });
            expect(mockRedisClient.get).toHaveBeenCalledWith('cache:testKey');
        });

        it('should return null on cache miss', async () => {
            mockRedisClient.get.mockResolvedValue(null);

            const result = await cacheGet('missKey');

            expect(result).toBeNull();
        });

        it('should use namespace when provided', async () => {
            mockRedisClient.get.mockResolvedValue(null);

            await cacheGet('key', { namespace: 'products' });

            expect(mockRedisClient.get).toHaveBeenCalledWith('cache:products:key');
        });
    });

    describe('cacheSet', () => {
        it('uses both a namespace and custom TTL', async () => {
            await cacheSet('key', { value: 1 }, { namespace: 'products', ttl: 60 });
            expect(mockRedisClient.setex).toHaveBeenCalledExactlyOnceWith('cache:products:key', 60, '{"value":1}');
        });

        it('does not throw when Redis rejects a write', async () => {
            mockRedisClient.setex.mockRejectedValue(new Error('Write failed'));
            await expect(cacheSet('key', 'value')).resolves.toBeUndefined();
        });

        it('does not write values that cannot be serialized', async () => {
            const circular: { self?: unknown } = {};
            circular.self = circular;
            await expect(cacheSet('key', circular)).resolves.toBeUndefined();
            expect(mockRedisClient.setex).not.toHaveBeenCalled();
        });

        it('skips serialized payloads over the size limit', async () => {
            await cacheSet('key', 'x'.repeat(MAX_CACHE_SIZE - 1));
            expect(mockRedisClient.setex).not.toHaveBeenCalled();
        });

        it('allows serialized payloads exactly at the size limit', async () => {
            const value = 'x'.repeat(MAX_CACHE_SIZE - 2);
            await cacheSet('key', value);
            expect(mockRedisClient.setex).toHaveBeenCalledExactlyOnceWith('cache:key', 300, JSON.stringify(value));
        });

        it('should set value with default TTL', async () => {
            await cacheSet('testKey', { data: 'value' });

            expect(mockRedisClient.setex).toHaveBeenCalledWith(
                'cache:testKey',
                300, // Default TTL
                JSON.stringify({ data: 'value' })
            );
        });

        it('should use custom TTL when provided', async () => {
            await cacheSet('testKey', 'value', { ttl: CacheTTL.HOUR });

            expect(mockRedisClient.setex).toHaveBeenCalledWith(
                'cache:testKey',
                3600,
                JSON.stringify('value')
            );
        });
    });

    describe('cacheDelete', () => {
        it('deletes only the namespaced key', async () => {
            await cacheDelete('key', { namespace: 'products' });
            expect(mockRedisClient.del).toHaveBeenCalledExactlyOnceWith('cache:products:key');
        });

        it('does not throw when Redis rejects a deletion', async () => {
            mockRedisClient.del.mockRejectedValue(new Error('Delete failed'));
            await expect(cacheDelete('key')).resolves.toBeUndefined();
        });

        it('should delete specified key', async () => {
            await cacheDelete('testKey');

            expect(mockRedisClient.del).toHaveBeenCalledWith('cache:testKey');
        });
    });

    describe('cacheDeletePattern', () => {
        it('reports actual removals rather than scanned duplicate keys', async () => {
            mockRedisClient.scan.mockResolvedValueOnce(['0', ['cache:a', 'cache:a']]); mockRedisClient.del.mockResolvedValueOnce(1);
            expect(await cacheDeletePattern('*')).toBe(1);
        });
        it('scans through all cursors, including empty intermediate pages', async () => {
            mockRedisClient.del.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
            mockRedisClient.scan
                .mockResolvedValueOnce(['12', ['cache:products:a', 'cache:products:b']])
                .mockResolvedValueOnce(['24', []])
                .mockResolvedValueOnce(['0', ['cache:products:c']]);

            expect(await cacheDeletePattern('*', 'products')).toBe(3);
            expect(mockRedisClient.scan.mock.calls).toEqual([
                ['0', 'MATCH', 'cache:products:*', 'COUNT', 100],
                ['12', 'MATCH', 'cache:products:*', 'COUNT', 100],
                ['24', 'MATCH', 'cache:products:*', 'COUNT', 100],
            ]);
            expect(mockRedisClient.del.mock.calls).toEqual([
                ['cache:products:a', 'cache:products:b'], ['cache:products:c'],
            ]);
        });

        it('supports patterns without a namespace', async () => {
            expect(await cacheDeletePattern('item:*')).toBe(0);
            expect(mockRedisClient.scan).toHaveBeenCalledExactlyOnceWith('0', 'MATCH', 'cache:item:*', 'COUNT', 100);
            expect(mockRedisClient.del).not.toHaveBeenCalled();
        });

        it('returns zero when scanning fails', async () => {
            mockRedisClient.scan.mockRejectedValue(new Error('Scan failed'));
            await expect(cacheDeletePattern('*')).resolves.toBe(0);
            expect(mockRedisClient.del).not.toHaveBeenCalled();
        });

        it('stops without throwing when deletion fails', async () => {
            mockRedisClient.scan.mockResolvedValueOnce(['12', ['cache:key']]);
            mockRedisClient.del.mockRejectedValue(new Error('Delete failed'));
            await expect(cacheDeletePattern('*')).resolves.toBe(0);
            expect(mockRedisClient.scan).toHaveBeenCalledTimes(1);
        });
    });

    describe('cacheAside', () => {
        it.each([false, 0, '', [], { value: 'cached' }])('returns a cache hit without fetching or writing: %j', async value => {
            mockRedisClient.get.mockResolvedValue(JSON.stringify(value));
            const fetchFn = vi.fn();
            await expect(cacheAside('key', fetchFn)).resolves.toEqual(value);
            expect(fetchFn).not.toHaveBeenCalled();
            expect(mockRedisClient.setex).not.toHaveBeenCalled();
        });

        it('fetches on a miss and caches with the supplied namespace and TTL', async () => {
            const value = { source: 'database' };
            const fetchFn = vi.fn().mockResolvedValue(value);
            await expect(cacheAside('key', fetchFn, { namespace: 'products', ttl: 60 })).resolves.toBe(value);
            expect(fetchFn).toHaveBeenCalledExactlyOnceWith();
            expect(mockRedisClient.get).toHaveBeenCalledWith('cache:products:key');
            expect(mockRedisClient.setex).toHaveBeenCalledWith('cache:products:key', 60, JSON.stringify(value));
        });

        it('fetches fresh data after a malformed cache entry', async () => {
            mockRedisClient.get.mockResolvedValue('not-json');
            const fetchFn = vi.fn().mockResolvedValue('fresh');
            await expect(cacheAside('key', fetchFn)).resolves.toBe('fresh');
            expect(fetchFn).toHaveBeenCalledOnce();
        });

        it('still returns fetched data when Redis reads and writes both fail', async () => {
            mockRedisClient.get.mockRejectedValue(new Error('Read failed'));
            mockRedisClient.setex.mockRejectedValue(new Error('Write failed'));
            const fetchFn = vi.fn().mockResolvedValue('fresh');
            await expect(cacheAside('key', fetchFn)).resolves.toBe('fresh');
            expect(fetchFn).toHaveBeenCalledOnce();
        });

        it('propagates fetch failures without writing to the cache', async () => {
            const error = new Error('Database unavailable');
            await expect(cacheAside('key', vi.fn().mockRejectedValue(error))).rejects.toBe(error);
            expect(mockRedisClient.setex).not.toHaveBeenCalled();
        });

        it('returns oversized fetched data without writing it back into the cache', async () => {
            const oversized = 'x'.repeat(MAX_CACHE_SIZE);
            mockRedisClient.get.mockResolvedValue(JSON.stringify(oversized));
            await expect(cacheAside('key', vi.fn().mockResolvedValue(oversized))).resolves.toBe(oversized);
            expect(mockRedisClient.del).toHaveBeenCalledWith('cache:key');
            expect(mockRedisClient.setex).not.toHaveBeenCalled();
        });
    });

    describe('invalidateCache', () => {
        it('invalidates an entire namespace', async () => {
            mockRedisClient.scan.mockResolvedValue(['0', ['cache:products:a']]);
            await invalidateCache('products');
            expect(mockRedisClient.scan).toHaveBeenCalledExactlyOnceWith('0', 'MATCH', 'cache:products:*', 'COUNT', 100);
            expect(mockRedisClient.del).toHaveBeenCalledExactlyOnceWith('cache:products:a');
        });

        it('restricts entity invalidation to the supplied namespace and prefix', async () => {
            await invalidateCache('products', 'tenant-1');
            expect(mockRedisClient.scan).toHaveBeenCalledExactlyOnceWith('0', 'MATCH', 'cache:products:tenant-1*', 'COUNT', 100);
            expect(mockRedisClient.del).not.toHaveBeenCalled();
        });

        it('does not throw when Redis cannot scan for invalidation', async () => {
            mockRedisClient.scan.mockRejectedValue(new Error('Scan failed'));
            await expect(invalidateCache('products')).resolves.toBeUndefined();
        });
    });

    describe('CacheTTL constants', () => {
        it('should have correct TTL values', () => {
            expect(CacheTTL.SHORT).toBe(30);
            expect(CacheTTL.MEDIUM).toBe(300);
            expect(CacheTTL.LONG).toBe(1800);
            expect(CacheTTL.HOUR).toBe(3600);
            expect(CacheTTL.DAY).toBe(86400);
        });
    });

    describe('CacheNamespace constants', () => {
        it('should have predefined namespaces', () => {
            expect(CacheNamespace.ANALYTICS).toBe('analytics');
            expect(CacheNamespace.PRODUCTS).toBe('products');
            expect(CacheNamespace.CUSTOMERS).toBe('customers');
        });
    });
});
