import { describe, expect, it, vi } from 'vitest';
const findMany = vi.hoisted(() => vi.fn());
vi.mock('../../utils/prisma', () => ({ prisma: { trackedKeyword: { findMany } } }));
import { KeywordRevenueService } from './KeywordRevenueService';
describe('stored keyword revenue report', () => {
    it('does not manufacture measured zeroes for metrics that were not persisted', async () => {
        findMany.mockResolvedValue([{ id: 'kw', keyword: 'Query', targetUrl: null, estimatedRevenue: 25 }]);
        expect(await KeywordRevenueService.getRevenueReport('tenant')).toEqual([{ keywordId: 'kw', keyword: 'Query', targetUrl: null, sessions: null, conversions: null, estimatedRevenue: 25 }]);
    });
});
