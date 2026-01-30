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

// Import after mocking
import { cacheGet, cacheSet, cacheDelete, CacheTTL, CacheNamespace } from '../cache';

describe('Cache Utilities', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('cacheGet', () => {
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
        it('should delete specified key', async () => {
            await cacheDelete('testKey');

            expect(mockRedisClient.del).toHaveBeenCalledWith('cache:testKey');
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
