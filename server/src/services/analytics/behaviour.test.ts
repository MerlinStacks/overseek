import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { NON_PAGE_PATH_PATTERN, NON_PAGE_QUERY_PATTERN, PAGE_VIEW_TYPES, TRACKING_KEY_PATTERN } from '../tracking/pageTracking';

vi.mock('../../utils/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));

import { prisma } from '../../utils/prisma';
import { BehaviourAnalytics } from './behaviour';

function recordedQuery(index = 0) {
    const [fragments, ...parameters] = vi.mocked(prisma.$queryRaw).mock.calls[index];
    return Prisma.sql(fragments as TemplateStringsArray, ...parameters);
}

describe('Pages report', () => {
    beforeEach(() => vi.clearAllMocks());

    it('counts specialized page visits and chooses a nonempty title per URL without truncation', async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
            { url: 'https://shop.test/cart/', pageTitle: 'Cart - Shop', views: 30n, entries: 10n, exits: 15n },
            { url: 'https://shop.test/product/gift/', pageTitle: 'Gift - Shop', views: 20n, entries: 5n, exits: 4n },
        ]);
        const start = '2026-10-01T00:00:00Z';
        const end = '2026-10-16T00:00:00Z';

        expect(await BehaviourAnalytics.getBehaviourPages('account-1', start, end)).toEqual([
            { url: 'https://shop.test/cart/', title: 'Cart - Shop', views: 30, entries: 10, exits: 15, exitRate: 50 },
            { url: 'https://shop.test/product/gift/', title: 'Gift - Shop', views: 20, entries: 5, exits: 4, exitRate: 20 },
        ]);

        const query = recordedQuery();
        const sql = query.sql;
        expect(query.values.slice(0, 3)).toEqual(['account-1', new Date(start), new Date(end)]);
        expect(query.values).toEqual(expect.arrayContaining(PAGE_VIEW_TYPES));
        expect(sql).toContain('s."accountId" = ?');
        expect(sql).toContain('e."createdAt" >= ?');
        expect(sql).toContain('e."createdAt" <= ?');
        expect(sql).toContain("NULLIF(BTRIM(e.url), '') IS NOT NULL");
        expect(sql).toContain('SELECT DISTINCT ON (url) url, "pageTitle"');
        expect(sql).toContain('NULLIF(BTRIM("pageTitle"), \'\') IS NOT NULL');
        expect(sql).toContain('ORDER BY url, "createdAt" DESC, id DESC');
        expect(sql).toContain('FROM RankedVisits v');
        expect(sql).not.toMatch(/LIMIT\s+50/i);
        expect(sql).not.toContain('GROUP BY e.url, e."pageTitle"');
    });

    it('derives entries and exits from the same period page visits, not arbitrary interaction events', async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
        await BehaviourAnalytics.getBehaviourPages('account-2');
        const sql = recordedQuery().sql;
        expect(sql).toContain('PARTITION BY visit_key ORDER BY "createdAt", id');
        expect(sql).toContain('PARTITION BY visit_key ORDER BY "createdAt" DESC, id DESC');
        expect(sql).toContain("COALESCE('visit:' || \"visitId\"");
        expect(sql).toContain("INTERVAL '30 minutes'");
        expect(sql).toContain('FROM Activity');
        expect(sql).toContain('FROM PageVisits');
        expect(sql).toContain('COUNT(*) FILTER (WHERE v.entry_rank = 1) AS entries');
        expect(sql).toContain('COUNT(*) FILTER (WHERE v.exit_rank = 1) AS exits');
    });

    it('retains an honest fallback if no recorded title exists', async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
            { url: 'https://shop.test/old/', pageTitle: null, views: 1n, entries: 1n, exits: 1n },
        ]);
        expect(await BehaviourAnalytics.getBehaviourPages('account-1')).toEqual([
            { url: 'https://shop.test/old/', title: 'Untitled', views: 1, entries: 1, exits: 1, exitRate: 100 },
        ]);
    });

    it('normalizes tracking URLs before ranking visits and aggregating titles or metrics', async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
        await BehaviourAnalytics.getBehaviourPages('account-1');
        const sql = recordedQuery().sql;
        expect(sql).toContain('WITH Activity AS');
        expect(sql).toContain("split_part(split_part(e.url, '#', 1), '?', 1)");
        expect(sql).toContain("COALESCE('?' || (");
        expect(sql).toContain('FROM VisitActivity e');
        expect(sql.indexOf('AS url')).toBeLessThan(sql.indexOf('), RankedVisits AS'));
        expect(sql).toContain('FROM PageVisits');
        expect(sql).toContain('LEFT JOIN PageTitles t ON t.url = v.url');
    });

    it('removes tracking keys case-insensitively without dropping functional query values', async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
        await BehaviourAnalytics.getBehaviourPages('account-1');
        const query = recordedQuery();
        const sql = query.sql;
        expect(query.values).toContain(TRACKING_KEY_PATTERN);
        const pattern = TRACKING_KEY_PATTERN;
        const trackingKey = new RegExp(pattern, 'i');
        for (const key of ['utm_source', 'UTM_CAMPAIGN', 'mtm_campaign', 'gad_source', 'gad_campaignid', 'gbraid', 'gclid', 'fbclid', 'msclkid', 'srsltid', '_gl']) {
            expect(trackingKey.test(key), key).toBe(true);
        }
        for (const key of ['s', 'q', 'page', 'orderby', 'variation_id', 'attribute_pa_colour', 'my_utm_source', 'product_id']) {
            expect(trackingKey.test(key), key).toBe(false);
        }
        expect(sql).toContain("string_agg(parameter, '&' ORDER BY position)");
        expect(sql).toContain('WITH ORDINALITY AS parts(parameter, position)');
    });

    it.each(['getBehaviourPages', 'getEntryPages', 'getExitPages'] as const)(
        '%s excludes historical AJAX URLs before selecting page visits', async (method) => {
            vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
            await BehaviourAnalytics[method]('account-1');
            const query = recordedQuery();
            expect(query.values).toEqual(expect.arrayContaining([
                ...PAGE_VIEW_TYPES, NON_PAGE_QUERY_PATTERN, NON_PAGE_PATH_PATTERN,
            ]));
            expect(query.sql.indexOf('WHERE e.type IN')).toBeLessThan(query.sql.indexOf('), RankedVisits AS'));
            expect(query.sql).toContain('PARTITION BY visit_key');
        }
    );

    it('excludes AJAX URLs from product page view counts', async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 0n }]);
        await BehaviourAnalytics.getProductPageViews('account-1', 'https://shop.test/product/gift/');
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        for (let index = 0; index < 2; index++) {
            expect(recordedQuery(index).values).toEqual(expect.arrayContaining([NON_PAGE_QUERY_PATTERN, NON_PAGE_PATH_PATTERN]));
        }
    });
});
