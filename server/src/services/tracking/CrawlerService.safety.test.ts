import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ upsert: vi.fn(), group: vi.fn(), rules: vi.fn(), aggregate: vi.fn(), query: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { crawlerLog: { upsert: m.upsert, groupBy: m.group, aggregate: m.aggregate }, crawlerRule: { findMany: m.rules }, $queryRaw: m.query } }));
vi.mock('../../utils/cache', () => ({ cacheAside: async (_key, fn) => fn(), CacheTTL: {}, cacheDelete: vi.fn() }));
vi.mock('../../utils/logger', () => ({ Logger: { debug: vi.fn() } }));
vi.mock('./GeoIPService', () => ({ geoipLookupSync: vi.fn() }));
import { getCrawlerStats, logHitIfIdentifiable } from './CrawlerService';
beforeEach(() => { vi.resetAllMocks(); m.rules.mockResolvedValue([]); m.group.mockResolvedValue([]); m.query.mockResolvedValue([]); m.aggregate.mockResolvedValue({ _sum: { hitCount: 2, blockedHitCount: 3 } }); });
describe('truthful bounded crawler observations', () => {
    it('uses UTC calendar-day totals and labels rule matches instead of claiming rolling enforcement', async () => {
        const result = await getCrawlerStats('tenant', 7); expect(result).toMatchObject({ totalHitsToday: 5, totalRuleMatchedHitsToday: 3, timeBasis: 'UTC-calendar-day' }); expect(result).not.toHaveProperty('totalHits24h');
        const since = m.aggregate.mock.calls[0][0].where.date.gte as Date; expect(since.getUTCHours()).toBe(0); expect(since.getUTCMinutes()).toBe(0);
    });
    it('hashes unknown identities beyond their shared first 40 characters', async () => {
        await logHitIfIdentifiable('tenant', `${'z'.repeat(45)} mysterybot one`); await logHitIfIdentifiable('tenant', `${'z'.repeat(45)} mysterybot two`);
        const names = m.upsert.mock.calls.map(([call]) => call.create.crawlerName); expect(names[0]).toMatch(/^unknown:bot:[0-9a-f]{2}$/); expect(names[0]).not.toBe(names[1]);
    });
    it('rejects unbounded day ranges before database queries', async () => { await expect(getCrawlerStats('tenant', Infinity)).rejects.toThrow(); expect(m.group).not.toHaveBeenCalled(); });
});
