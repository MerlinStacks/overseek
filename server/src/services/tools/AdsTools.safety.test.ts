import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ accounts: vi.fn(), meta: vi.fn(), google: vi.fn(), optimizer: vi.fn(), pipeline: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { adAccount: { findMany: m.accounts }, adSuggestionContext: { findUnique: async () => ({ context: 'Stored business context' }) } } }));
vi.mock('../ads', () => ({ AdsService: { getMetaInsights: m.meta, getGoogleInsights: m.google } }));
vi.mock('./GoogleAdsTools', () => ({ GoogleAdsTools: {} })); vi.mock('./MetaAdsTools', () => ({ MetaAdsTools: {} }));
vi.mock('./AdOptimizer', () => ({ AdOptimizer: { getAdOptimizationSuggestions: m.optimizer } }));
vi.mock('./analyzers/AnalysisPipeline', () => ({ AnalysisPipeline: { runAll: m.pipeline } }));
import { AdsTools } from './AdsTools';
const metric = (spend: number, roas: number, currency = 'AUD') => ({ spend, roas, currency, clicks: 10, impressions: 100, date_start: '2026-10-01', date_stop: '2026-10-21' });
beforeEach(() => { vi.clearAllMocks(); m.accounts.mockResolvedValue([{ id: '1', platform: 'META' }, { id: '2', platform: 'META' }]); m.optimizer.mockResolvedValue({ suggestions: ['Review'], action_items: [] }); m.pipeline.mockResolvedValue({ actionableRecommendations: [] }); });
it('spend-weights compatible ROAS rather than averaging account ratios', async () => {
    m.meta.mockResolvedValueOnce(metric(10, 10)).mockResolvedValueOnce(metric(90, 1));
    const result = await AdsTools.compareAdPlatforms('a'); expect(result.meta).toMatchObject({ avg_roas: 1.9, total_spend: 100, currency: 'AUD', coverage: { observed: 2, complete: true } }); expect(result.recommendation).toBeNull();
});
it('refuses mixed-currency totals and discloses missing accounts', async () => {
    m.meta.mockResolvedValueOnce(metric(10, 2)).mockResolvedValueOnce(metric(90, 2, 'USD'));
    expect((await AdsTools.compareAdPlatforms('a')).meta.available).toBe(false);
    m.meta.mockResolvedValueOnce(metric(10, 2)).mockRejectedValueOnce(Error('offline'));
    expect((await AdsTools.compareAdPlatforms('a')).meta.coverage).toEqual({ expected: 2, observed: 1, complete: false });
});
it('preserves zero-spend and zero-impression ratios as unavailable', async () => {
    m.meta.mockResolvedValue({ ...metric(0, 0), impressions: 0, clicks: 0 }); expect((await AdsTools.compareAdPlatforms('a')).meta).toMatchObject({ avg_roas: null, avg_ctr: null });
});
it('uses identical resolved context for both analyses and preserves successful output on partial failure', async () => {
    m.pipeline.mockRejectedValue(Error('offline')); const result = await AdsTools.getAdOptimizationSuggestions('a');
    expect(m.optimizer).toHaveBeenCalledWith('a', { userContext: 'Stored business context' }); expect(m.pipeline).toHaveBeenCalledWith('a', 'Stored business context'); expect(result).toMatchObject({ suggestions: ['Review'], availability: { optimizer: true, pipeline: false } });
});
