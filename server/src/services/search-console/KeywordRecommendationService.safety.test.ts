import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ products: vi.fn(), account: vi.fn(), analytics: vi.fn(), trends: vi.fn(), fetch: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooProduct: { findMany: m.products }, account: { findUnique: m.account } } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('./SearchConsoleService', () => ({ SearchConsoleService: { getSearchAnalytics: m.analytics, getSearchTrends: m.trends } }));
import { KeywordRecommendationService } from './KeywordRecommendationService';
import { boundedProviderJson } from './recommendationValidation';
const valid = { title: 'Candidate idea', description: 'A hypothesis from returned observations', keywords: ['ring'], priority: 'low', effort: 'low', expectedImpact: 'Uncertain; evaluate with a controlled test', actionType: 'content' };
beforeEach(() => { vi.clearAllMocks(); m.products.mockResolvedValue([{ name: 'Gold ring', price: 1000, rawData: { categories: { invalid: true } } }]); m.account.mockResolvedValue({ openRouterApiKey: 'fake', aiModel: 'model' }); m.analytics.mockResolvedValue([{ query: 'silver ring', clicks: 1, impressions: 100, ctr: 1, position: 10 }]); m.trends.mockResolvedValue([]); vi.stubGlobal('fetch', m.fetch); });
afterEach(() => vi.unstubAllGlobals());
it('bounds catalog scans and discloses sample-based candidates and CTR assumptions', async () => {
    const gaps = await KeywordRecommendationService.getKeywordGaps('a'); expect(gaps[0]).toMatchObject({ priority: 'low', coverage: { basis: 'returned-query-sample', catalogLimited: false } });
    expect(m.products).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', stockStatus: 'instock' }, take: 501 }));
    expect((await KeywordRecommendationService.getLowHangingFruit('a'))[0].assumptions).toMatch(/not a traffic forecast/);
});
it('accepts only a complete validated model response and passes a deadline signal', async () => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ recommendations: [valid] }) } }] })));
    expect(await KeywordRecommendationService.getAIRecommendations('a')).toEqual([valid]); expect(m.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it.each(['length', 'stop'])('rejects truncated or invalid AI output (%s) rather than repairing it', async finish_reason => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: '{"recommendations":[{"title":"cut off' } }] })));
    await expect(KeywordRecommendationService.getAIRecommendations('a')).rejects.toThrow(/unavailable/);
});
it('reports unconfigured AI as unavailable, not a successful empty result', async () => { m.account.mockResolvedValue({}); await expect(KeywordRecommendationService.getAIRecommendations('a')).rejects.toThrow(/unavailable/); expect(m.fetch).not.toHaveBeenCalled(); });
it('rejects failed and oversized provider responses', async () => { await expect(boundedProviderJson(new Response('failure', { status: 500 }))).rejects.toThrow(); await expect(boundedProviderJson(new Response('large', { headers: { 'content-length': '70000' } }))).rejects.toThrow(); });
