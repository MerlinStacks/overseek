import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../utils/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));

import { prisma } from '../../utils/prisma';
import { RoadblockAnalytics } from './roadblock';
import { NON_PAGE_PATH_PATTERN, NON_PAGE_QUERY_PATTERN } from '../tracking/pageTracking';

describe('roadblock pages', () => {
    beforeEach(() => vi.clearAllMocks());

    it('uses all page visits as denominator, not just exit visits', async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
            { url: '/cart/', pageTitle: 'Cart', totalVisits: 10n, exits: 4n, avgCartValue: '25.125', potentialRevenueLost: '100.50' },
            { url: '/gift/', pageTitle: null, totalVisits: 20n, exits: 1n, avgCartValue: '10', potentialRevenueLost: '10' },
            { url: '/paid/', pageTitle: 'Paid', totalVisits: 1n, exits: 1n, avgCartValue: '0', potentialRevenueLost: '0' },
        ]);
        expect(await RoadblockAnalytics.getRoadblockPages('account-1')).toEqual([
            { url: '/cart/', pageTitle: 'Cart', totalVisits: 10, exits: 4, exitRate: 40, avgCartValue: 25.13, potentialRevenueLost: 100.5 },
        ]);
        const [fragments, ...parameters] = vi.mocked(prisma.$queryRaw).mock.calls[0];
        const query = Prisma.sql(fragments as TemplateStringsArray, ...parameters);
        expect(query.sql).toContain('COUNT(DISTINCT v.visit_key) AS "totalVisits"');
        expect(query.sql).toContain('WHERE v.exit_rank = 1');
        expect(query.sql).toContain('FROM VisitActivity');
        expect(query.sql).toContain("type IN ('purchase', 'checkout_success') THEN '0'");
        expect(query.sql).toContain("NOW() - INTERVAL '30 minutes'");
        expect(query.sql).not.toContain('s."cartValue"');
        expect(query.values).toEqual(expect.arrayContaining([NON_PAGE_PATH_PATTERN, NON_PAGE_QUERY_PATTERN]));
    });

    it('ranks by potential lost revenue and limits only the final results', async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(Array.from({ length: 60 }, (_, index) => ({
            url: `/page/${index}`, pageTitle: null, totalVisits: 5n, exits: 2n,
            avgCartValue: index + 1, potentialRevenueLost: index + 1,
        })));
        const rows = await RoadblockAnalytics.getRoadblockPages('account-1');
        expect(rows).toHaveLength(50);
        expect(rows[0]).toMatchObject({ url: '/page/59', pageTitle: '/page/59', exitRate: 40 });
    });
});
