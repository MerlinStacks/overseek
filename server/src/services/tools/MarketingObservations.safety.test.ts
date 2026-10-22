import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ accounts: vi.fn(), orders: vi.fn(), products: vi.fn(), events: vi.fn(), trends: vi.fn(), campaigns: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: async () => ({ timezone: 'UTC', currency: 'AUD' }) }, adAccount: { findMany: m.accounts }, wooOrder: { findMany: m.orders }, wooProduct: { findMany: m.products }, analyticsEvent: { findMany: m.events } } }));
vi.mock('../ads', () => ({ AdsService: { getGoogleDailyTrends: m.trends, getMetaDailyTrends: m.trends, getGoogleCampaignInsights: m.campaigns } }));
import { MultiPeriodAnalyzer } from './analyzers/MultiPeriodAnalyzer';
import { MarketingStrategyAdvisor } from './advisors/MarketingStrategyAdvisor';
import { SearchCampaignAdvisor } from './advisors/SearchCampaignAdvisor';
import { KeywordOpportunityAnalyzer } from './analyzers/KeywordOpportunityAnalyzer';
import { ProductOpportunityAnalyzer } from './analyzers/ProductOpportunityAnalyzer';
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T12:00:00Z')); m.accounts.mockResolvedValue([{ id: 'ad', platform: 'GOOGLE', currency: 'AUD' }]); m.orders.mockResolvedValue([]); m.events.mockResolvedValue([]); m.products.mockResolvedValue([]); });
afterEach(() => vi.useRealTimers());
function daily(days = 90) { return Array.from({ length: days }, (_, index) => ({ date: new Date(Date.parse('2026-10-22') - (index + 1) * 86400000).toISOString().slice(0, 10), spend: 10, conversionsValue: 20, clicks: 5, impressions: 100, conversions: 1 })); }
it('sorts by actual dates, uses complete calendar days and never emits significance/budget actions', async () => {
    m.trends.mockResolvedValue(daily()); const result = await MultiPeriodAnalyzer.analyze('a');
    expect(result.combined['7d']).toMatchObject({ spend: 70, revenue: 140, roas: 2 }); expect(result.coverage.complete).toBe(true);
    expect(result.trends.roas_7d_vs_30d.confidence).toBeNull(); expect(result.actionableRecommendations).toEqual([]);
});
it('does not fill missing days, duplicate dates, mixed currencies or failed accounts with zeros', async () => {
    m.trends.mockResolvedValue(daily(6)); expect((await MultiPeriodAnalyzer.analyze('a')).combined['7d']).toBeNull();
    m.trends.mockResolvedValue([...daily(), daily()[0]]); expect((await MultiPeriodAnalyzer.analyze('a')).accounts[0].available).toBe(false);
    m.accounts.mockResolvedValue([{ id: 'ad', platform: 'GOOGLE', currency: 'AUD' }, { id: 'other', platform: 'META', currency: 'USD' }]); m.trends.mockResolvedValue(daily()); expect((await MultiPeriodAnalyzer.analyze('a')).combined['7d']).toBeNull();
    m.trends.mockResolvedValueOnce(daily()).mockRejectedValueOnce(Error('offline')); expect((await MultiPeriodAnalyzer.analyze('a')).coverage).toMatchObject({ expected: 2, observed: 1, complete: false });
});
it('preserves zero denominators as unknown ratios', async () => {
    m.trends.mockResolvedValue(daily().map(day => ({ ...day, spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionsValue: 0 })));
    expect((await MultiPeriodAnalyzer.analyze('a')).combined['7d']).toMatchObject({ roas: null, ctr: null, cpc: null, cpa: null });
});
it('measures identified-customer repeat purchases instead of inventing a repeat rate', async () => {
    m.orders.mockResolvedValue([{ total: 10, rawData: { currency: 'AUD', customer_id: 1 } }, { total: 20, rawData: { currency: 'AUD', customer_id: 1 } }, { total: 30, rawData: { currency: 'AUD', customer_id: 2 } }, { total: 40, rawData: { currency: 'AUD', customer_id: 0 } }]);
    m.trends.mockResolvedValue([]); const result = await MarketingStrategyAdvisor.analyze('a'); expect(result.summary).toMatchObject({ repeatRate: 50, identifiedCustomers: 2, revenue: 100, avgOrderValue: 25, portfolioHealth: null }); expect(result.recommendations).toEqual([]);
});
it('selects Search from provider channel type, not names, and uses weighted ratios', async () => {
    const row = { currency: 'AUD', dateStart: '2026-09-22', dateStop: '2026-10-21', clicks: 10, impressions: 100, conversions: 1 };
    m.campaigns.mockResolvedValue([{ ...row, campaignId: '1', campaignName: 'Shopping search', advertisingChannelType: 'SHOPPING', spend: 100, conversionsValue: 900 }, { ...row, campaignId: '2', campaignName: 'Brand', advertisingChannelType: 'SEARCH', spend: 10, conversionsValue: 100 }, { ...row, campaignId: '3', campaignName: 'Generic', advertisingChannelType: 'SEARCH', spend: 90, conversionsValue: 90 }]);
    const result = await SearchCampaignAdvisor.analyze('a'); expect(result.summary).toMatchObject({ campaignsAnalyzed: 2, totalSearchSpend: 100, avgSearchRoas: 1.9 }); expect(result.recommendations).toEqual([]);
});
it('attributes only a later, deduplicated purchase to the last preceding same-session term', async () => {
    const event = (id: string, type: string, at: number, payload: unknown) => ({ id, type, createdAt: new Date(1000 * at), sessionId: 's', payload });
    m.events.mockResolvedValue([event('1', 'purchase', 1, { transaction_id: 'early', value: 999, currency: 'AUD' }), event('2', 'search', 2, { query: '日本語 指輪' }), event('3', 'search', 3, { query: 'Gold ring' }), event('4', 'purchase', 4, { transaction_id: 'paid', value: 20, currency: 'AUD' }), event('5', 'purchase', 5, { transaction_id: 'paid', value: 20, currency: 'AUD' }), event('6', 'search', 6, { query: {} })]);
    const result = await KeywordOpportunityAnalyzer.analyze('a'); expect(result.observations.find(row => row.term === 'gold ring')).toMatchObject({ associatedPurchasingSessions: 1, conversionValue: 20, paidKeywordCoverage: 'unknown' }); expect(result.observations.find(row => row.term === '日本語 指輪')?.associatedPurchasingSessions).toBe(0); expect(result.keywordOpportunities).toEqual([]);
});
it('quantity-weights product revenue, preserves zero cost, filters stock and keeps ad coverage unknown', async () => {
    m.products.mockResolvedValue([{ wooId: 1, name: 'Product', sku: 'sku', cogs: 0, status: 'publish', stockStatus: 'instock' }, { wooId: 2, name: 'Out', cogs: 1, status: 'publish', stockStatus: 'outofstock' }]);
    m.orders.mockResolvedValue([{ rawData: { currency: 'AUD', line_items: [{ product_id: 1, quantity: '2', total: '30' }, { product_id: 1, quantity: 1, total: '30' }, { product_id: 2, quantity: 2, total: '10' }, { product_id: 1, quantity: 0, total: '100' }] } }]);
    const result = await ProductOpportunityAnalyzer.analyze('a'); expect(result.candidates).toHaveLength(1); expect(result.candidates[0]).toMatchObject({ unitsSold: 3, averageNetUnitRevenue: 20, currentCatalogCostMarginIndicator: 100, adCoverage: 'unknown' }); expect(result.coverage.invalidLines).toBe(1); expect(result.unpromotedProducts).toEqual([]);
});
