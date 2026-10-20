import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), organic: vi.fn(), paid: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { adAccount: { findMany: mocks.accounts } } }));
vi.mock('../search-console/SearchConsoleService', () => ({ SearchConsoleService: { getSearchAnalytics: mocks.organic } }));
vi.mock('./GoogleAdsService', () => ({ GoogleAdsService: { getSearchKeywords: mocks.paid } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { SearchToAdsIntelligenceService } from './SearchToAdsIntelligenceService';
const paid = { keywordText: 'blue widget', spend: 100, clicks: 50, impressions: 500, conversions: 2, conversionsValue: 200, ctr: 10, cpc: 2, roas: 2, currency: 'AUD' };
const organic = (query: string) => ({ query, clicks: 100, impressions: 1000, ctr: 10, position: 2 });
beforeEach(() => { vi.resetAllMocks(); mocks.accounts.mockResolvedValue([{ id: 'ad' }]); mocks.organic.mockResolvedValue([organic('blue widget')]); mocks.paid.mockResolvedValue([paid]); });
describe('organic paid correlation completeness', () => {
    it('matches reporting windows and requests strict provider failures', async () => {
        const result = await SearchToAdsIntelligenceService.getCorrelation('tenant'); expect(result.currency).toBe('AUD');
        expect(mocks.organic).toHaveBeenCalledWith('tenant', expect.objectContaining({ strict: true, endDate: result.reportingPeriod!.endDate }));
        expect(mocks.paid).toHaveBeenCalledWith('ad', 28, 500, { strict: true, endDate: result.reportingPeriod!.endDate });
    });
    it('does not turn provider failures into no-data results', async () => {
        mocks.paid.mockRejectedValue(new Error('Provider failed')); await expect(SearchToAdsIntelligenceService.getCorrelation('tenant')).rejects.toThrow('Provider failed');
    });
    it('refuses to combine money in different currencies', async () => {
        mocks.paid.mockResolvedValue([paid, { ...paid, currency: 'USD' }]); await expect(SearchToAdsIntelligenceService.getCorrelation('tenant')).rejects.toThrow('one known currency');
    });
    it('aggregates duplicate keywords and allocates their waste once across matching queries', async () => {
        mocks.paid.mockResolvedValue([paid, paid]); mocks.organic.mockResolvedValue(Array.from({ length: 10 }, (_, i) => organic(`blue widget ${i}`)));
        const result = await SearchToAdsIntelligenceService.getCorrelation('tenant');
        expect(result.summary.totalPaidKeywords).toBe(1); expect(result.paidOnlyCount).toBe(0); expect(result.overlap).toHaveLength(10);
        expect(result.overlap[0].paid.spend).toBe(200); expect(result.summary.estimatedTotalWastedSpend).toBe(100);
    });
    it('retains paid-only counts when a complete organic response is empty', async () => {
        mocks.organic.mockResolvedValue([]); const result = await SearchToAdsIntelligenceService.getCorrelation('tenant'); expect(result.paidOnlyCount).toBe(1);
    });
    it('does not present capped data as a complete comparison', async () => {
        mocks.organic.mockResolvedValue(Array.from({ length: 500 }, (_, i) => organic(`query ${i}`)));
        await expect(SearchToAdsIntelligenceService.getCorrelation('tenant')).rejects.toThrow('correlation limit');
    });
});
