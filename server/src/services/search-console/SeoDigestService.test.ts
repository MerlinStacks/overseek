import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ analytics: vi.fn() }));
vi.mock('./SearchConsoleService', () => ({ SearchConsoleService: { getSearchAnalytics: m.analytics } }));
import { SeoDigestService } from './SeoDigestService';
beforeEach(() => vi.resetAllMocks());
describe('period-aligned sampled SEO digests', () => {
    it('uses disjoint seven-day windows, weighted positions and unavailable revenue', async () => {
        m.analytics.mockResolvedValueOnce([{ query: 'a', clicks: 2, impressions: 10, position: 2 }, { query: 'b', clicks: 1, impressions: 90, position: 12 }]).mockResolvedValueOnce([]);
        const data = await SeoDigestService.generateDigest('tenant'); const current = m.analytics.mock.calls[0][1]; const previous = m.analytics.mock.calls[1][1];
        expect((Date.parse(current.endDate) - Date.parse(current.startDate)) / 86400000).toBe(6); expect(Date.parse(current.startDate) - Date.parse(previous.endDate)).toBe(86400000);
        expect(data.summary.avgPosition).toBe(11); expect(data.summary.positionChange).toBeNull(); expect(data.topKeywords[0].estimatedRevenue).toBeNull(); expect(data.coverage.basis).toBe('returned-query-sample');
    });
    it('does not invent a rank for empty samples', async () => { m.analytics.mockResolvedValue([]); expect((await SeoDigestService.generateDigest('tenant')).summary.avgPosition).toBeNull(); });
});
