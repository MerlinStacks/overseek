import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ analyze: vi.fn(), multi: vi.fn(), cross: vi.fn(), feedback: vi.fn() }));
vi.mock('./MultiPeriodAnalyzer', () => ({ MultiPeriodAnalyzer: { analyze: m.multi } }));
vi.mock('./CrossChannelAnalyzer', () => ({ CrossChannelAnalyzer: { analyze: m.cross } }));
vi.mock('./LTVAnalyzer', () => ({ LTVAnalyzer: { analyze: m.analyze } })); vi.mock('./FunnelAnalyzer', () => ({ FunnelAnalyzer: { analyze: m.analyze } })); vi.mock('./AudienceAnalyzer', () => ({ AudienceAnalyzer: { analyze: m.analyze } })); vi.mock('./ProductOpportunityAnalyzer', () => ({ ProductOpportunityAnalyzer: { analyze: m.analyze } })); vi.mock('./KeywordOpportunityAnalyzer', () => ({ KeywordOpportunityAnalyzer: { analyze: m.analyze } })); vi.mock('./NegativeKeywordAnalyzer', () => ({ NegativeKeywordAnalyzer: { analyze: m.analyze } })); vi.mock('./CannibalizationAnalyzer', () => ({ CannibalizationAnalyzer: { analyze: m.analyze } }));
vi.mock('../advisors/MarketingStrategyAdvisor', () => ({ MarketingStrategyAdvisor: { analyze: m.analyze } })); vi.mock('../advisors/SearchCampaignAdvisor', () => ({ SearchCampaignAdvisor: { analyze: m.analyze } }));
vi.mock('../feedback/FeedbackService', () => ({ getFeedbackContext: m.feedback, shouldFilterRecommendation: (rec: { id: string }, context: { dismissedIds: Set<string> }) => context.dismissedIds.has(rec.id) }));
vi.mock('../../../utils/prisma', () => ({ prisma: {} }));
import { AnalysisPipeline } from './AnalysisPipeline';
beforeEach(() => { vi.clearAllMocks(); m.analyze.mockResolvedValue({ hasData: false, suggestions: [] }); m.multi.mockResolvedValue({ hasData: true, suggestions: ['Observed account window'] }); m.cross.mockRejectedValue(Error('offline')); m.feedback.mockResolvedValue({ available: true, dismissedIds: new Set() }); });
it('isolates rejected sources, reports all outcomes, shares provider work and leaves confidence unknown', async () => {
    const result = await AnalysisPipeline.runAll('a'); expect(Object.keys(result.results)).toHaveLength(11); expect(result.results.crossChannel.status).toBe('unavailable'); expect(result.suggestions[0]).toMatchObject({ confidence: null, actionability: 'review-only' }); expect(result.actionableRecommendations).toEqual([]); expect(m.multi).toHaveBeenCalledOnce();
});
it('does not merge different full text sharing a prefix and does not execute legacy actions', async () => {
    m.cross.mockResolvedValue({ hasData: true, suggestions: ['x'.repeat(100) + ' first', 'x'.repeat(100) + ' second'], actionableRecommendations: [{ id: 'old-id', headline: 'Legacy action', action: { campaignId: 'c' }, confidence: 99 }] });
    const result = await AnalysisPipeline.runAll('a'); expect(result.suggestions).toHaveLength(4); expect(result.actionableRecommendations).toEqual([]); expect(result.suggestions.find(row => row.text === 'Legacy action')?.confidence).toBeNull();
});
it('preserves old dismissals and explicit quoted exclusions, failing closed on unavailable feedback', async () => {
    m.cross.mockResolvedValue({ hasData: true, suggestions: [{ id: 'dismissed', text: 'Old advice' }, 'Promote summer products'] }); m.feedback.mockResolvedValue({ available: true, dismissedIds: new Set(['dismissed']) });
    const result = await AnalysisPipeline.runAll('a', 'avoid "summer"'); expect(result.suggestions.map(row => row.text)).toEqual(['Observed account window']);
    m.feedback.mockRejectedValue(Error('offline')); expect((await AnalysisPipeline.runAll('a')).suggestions).toEqual([]);
});
it('rejects malformed source lists without poisoning successful observations', async () => {
    m.cross.mockResolvedValue({ hasData: true, suggestions: [{ text: [] }] }); const result = await AnalysisPipeline.runAll('a'); expect(result.results.crossChannel.status).toBe('unavailable'); expect(result.suggestions).toHaveLength(1);
});
