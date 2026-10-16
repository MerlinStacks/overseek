import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/prisma', () => ({ prisma: { analyticsEvent: { findMany: vi.fn() } } }));
vi.mock('../../../utils/logger', () => ({ Logger: { error: vi.fn() } }));

import { prisma } from '../../../utils/prisma';
import { getSearches } from '../EngagementMetrics';
import { BehaviourAnalytics } from '../../analytics/behaviour';

describe('Search analytics report consistency', () => {
    const range = {
        startDate: new Date('2026-10-16T00:00:00Z'),
        endDate: new Date('2026-10-16T23:59:59Z'),
    };

    beforeEach(() => vi.clearAllMocks());

    function mockEvents(events: Array<{ type: string; payload: unknown }>) {
        vi.mocked(prisma.analyticsEvent.findMany).mockResolvedValue(events as any);
    }

    it('shows the same normalized terms and counts as Overview, including search pageviews', async () => {
        mockEvents([
            { type: 'search', payload: { searchQuery: ' Hoodies ' } },
            { type: 'pageview', payload: { page_type: 'search', searchQuery: 'HOODIES' } },
            { type: 'search', payload: { term: 'Cups' } },
            { type: 'search', payload: { query: ' cups ' } },
            { type: 'pageview', payload: { page_type: 'product', searchQuery: 'ignored' } },
        ]);

        const overview = await getSearches('account-1', 1, range);
        const report = await BehaviourAnalytics.getSiteSearch(
            'account-1', range.startDate.toISOString(), range.endDate.toISOString()
        );

        expect(overview).toEqual({
            topQueries: [{ query: 'hoodies', count: 2 }, { query: 'cups', count: 2 }],
            totalSearches: 4,
        });
        expect(report).toEqual(overview.topQueries.map(({ query, count }) => ({ term: query, searches: count })));
        expect(prisma.analyticsEvent.findMany).toHaveBeenLastCalledWith({
            where: {
                session: { accountId: 'account-1' },
                type: { in: ['search', 'pageview'] },
                createdAt: { gte: range.startDate, lte: range.endDate },
            },
            select: { type: true, payload: true },
        });
    });

    it('omits missing, blank and malformed terms without losing valid fallbacks', async () => {
        mockEvents([
            { type: 'search', payload: null },
            { type: 'search', payload: {} },
            { type: 'search', payload: { searchQuery: '   ' } },
            { type: 'search', payload: { searchQuery: 123 } },
            { type: 'search', payload: { searchQuery: ' ', term: ' Gifts ' } },
            { type: 'search', payload: { searchQuery: {}, query: 'Gifts' } },
        ]);
        expect(await BehaviourAnalytics.getSiteSearch('account-1')).toEqual([{ term: 'gifts', searches: 2 }]);
    });

    it('retains the 50-term Site Search limit and 20-term Overview limit', async () => {
        mockEvents(Array.from({ length: 60 }, (_, i) => ({ type: 'search', payload: { searchQuery: `term ${i}` } })));
        expect((await getSearches('account-1')).topQueries).toHaveLength(20);
        expect(await BehaviourAnalytics.getSiteSearch('account-1')).toHaveLength(50);
    });

    it('returns an empty report when there are no searches', async () => {
        mockEvents([]);
        expect(await BehaviourAnalytics.getSiteSearch('account-1')).toEqual([]);
    });
});
