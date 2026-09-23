import { describe, expect, it, vi } from 'vitest';
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
import { checkFreshnessPrerequisite, createFreshnessPrerequisiteCheck, FRESHNESS_PREREQUISITE_CACHE_MS, FRESHNESS_PREREQUISITE_SQL } from './freshnessPrerequisite';

describe('freshness SQL prerequisite diagnostic', () => {
    it('bypasses diagnostic caching for critical checks using the supplied transaction connection', async () => {
        const query = vi.fn().mockResolvedValue([]);
        const db = { $queryRawUnsafe: query };
        expect((await checkFreshnessPrerequisite({ fresh: true, db: db as any })).ready).toBe(true);
        query.mockResolvedValue([{ missing: 'trigger:WooProduct.delivery_product_write' }]);
        const damaged = await checkFreshnessPrerequisite({ fresh: true, db: db as any });
        expect(damaged.ready).toBe(false); expect(damaged.missing).toEqual(['trigger:WooProduct.delivery_product_write']);
        expect(query).toHaveBeenCalledTimes(2);
        expect(query).toHaveBeenLastCalledWith(FRESHNESS_PREREQUISITE_SQL);
    });
    it('blocks missing SQL, coalesces admin requests and expires the short cache', async () => {
        let now = 0;
        const query = vi.fn().mockResolvedValue([{ missing: 'trigger:WooProduct.delivery_product_delete' }]);
        const check = createFreshnessPrerequisiteCheck(query, () => now);
        const results = await Promise.all([check(), check(), check()]);
        expect(query).toHaveBeenCalledTimes(1);
        expect(results.every(result => !result.ready && result.diagnostic?.includes('schema push'))).toBe(true);
        query.mockResolvedValue([]);
        expect((await check()).ready).toBe(false);
        now += FRESHNESS_PREREQUISITE_CACHE_MS;
        expect((await check()).ready).toBe(true);
        expect(query).toHaveBeenCalledTimes(2);
    });
    it('fails closed on inaccessible catalogs without leaking database details', async () => {
        const check = createFreshnessPrerequisiteCheck(vi.fn().mockRejectedValue(new Error('SECRET database credentials')));
        expect(await check()).toMatchObject({ ready: false, missing: ['catalog_check_unavailable'] });
        expect(JSON.stringify(await check())).not.toContain('SECRET');
    });
});
