import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => ({
    get: vi.fn(),
    del: vi.fn(),
    setex: vi.fn()
}));

vi.mock('../utils/redis', () => ({ redisClient: redis }));
vi.mock('../utils/prisma', () => ({
    prisma: {
        account: {
            findUnique: vi.fn(),
            update: vi.fn()
        }
    }
}));
vi.mock('../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    }
}));
vi.mock('../utils/runtimeMetrics', () => ({
    registerRuntimeMetricsProvider: vi.fn()
}));

import { WooService } from './woo';

describe('WooService variation pagination', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        redis.get.mockResolvedValue(null);
        redis.del.mockResolvedValue(1);
        redis.setex.mockResolvedValue('OK');
    });

    afterEach(() => {
        WooService.destroyAgents();
    });

    it('bypasses a stale single-product cache and refreshes it after a force fetch', async () => {
        const stale = { id: 42, type: 'variable' };
        const fresh = { id: 42, type: 'simple' };
        redis.get.mockResolvedValue(JSON.stringify(stale));
        const woo = new WooService({
            url: 'https://store.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test', accountId: 'account-1'
        });
        const request = vi.fn().mockResolvedValue({ data: fresh });
        (woo as any).requestWithRetry = request;
        await expect(woo.getProduct(42)).resolves.toEqual(stale);
        expect(request).not.toHaveBeenCalled();
        redis.get.mockClear();
        await expect(woo.getProduct(42, { bypassCache: true })).resolves.toEqual(fresh);
        expect(redis.get).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledExactlyOnceWith('get', 'products/42');
        expect(redis.setex).toHaveBeenCalledWith(expect.any(String), 30, JSON.stringify(fresh));
    });

    it('fetches and caches every variation page', async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
        const secondPage = Array.from({ length: 50 }, (_, index) => ({ id: index + 101 }));
        const woo = new WooService({
            url: 'https://store.example.com',
            consumerKey: 'ck_test',
            consumerSecret: 'cs_test',
            accountId: 'account-1'
        });
        const request = vi.fn()
            .mockResolvedValueOnce({ data: firstPage, total: 150, totalPages: 2 })
            .mockResolvedValueOnce({ data: secondPage, total: 150, totalPages: 2 });
        (woo as any).requestWithRetry = request;

        const variations = await woo.getProductVariations(42);

        expect(variations).toHaveLength(150);
        expect(request).toHaveBeenNthCalledWith(1, 'get', 'products/42/variations', {
            page: 1,
            per_page: 100
        });
        expect(request).toHaveBeenNthCalledWith(2, 'get', 'products/42/variations', {
            page: 2,
            per_page: 100
        });
        const cached = JSON.parse(redis.setex.mock.calls[0][2]);
        expect(cached.version).toBe(2);
        expect(cached.data).toHaveLength(150);
    });
    it('bypasses a valid but stale variation cache for strict stock calculations', async () => {
        redis.get.mockResolvedValue(JSON.stringify({ version: 2, data: [{ id: 11, stock_quantity: 100 }] }));
        const woo = new WooService({ url: 'https://store.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test', accountId: 'a' });
        const request = vi.fn().mockResolvedValue({ data: [{ id: 11, stock_quantity: 2 }], total: 1, totalPages: 1 });
        (woo as any).requestWithRetry = request;
        expect(await woo.getProductVariations(10, { bypassCache: true })).toEqual([{ id: 11, stock_quantity: 2 }]);
        expect(redis.get).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1);
    });

    it('rejects a legacy first-page-only cache entry', async () => {
        redis.get.mockResolvedValue(JSON.stringify([{ id: 1 }]));
        const woo = new WooService({
            url: 'https://store.example.com',
            consumerKey: 'ck_test',
            consumerSecret: 'cs_test',
            accountId: 'account-1'
        });
        const request = vi.fn().mockResolvedValue({ data: [], total: 0, totalPages: 0 });
        (woo as any).requestWithRetry = request;

        await expect(woo.getProductVariations(42)).resolves.toEqual([]);

        expect(redis.del).toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('configures a bounded request timeout', () => {
        const woo = new WooService({
            url: 'https://store.example.com',
            consumerKey: 'ck_test',
            consumerSecret: 'cs_test'
        });

        expect((woo as any).axiosConfig.timeout).toBeGreaterThan(0);
    });
});
