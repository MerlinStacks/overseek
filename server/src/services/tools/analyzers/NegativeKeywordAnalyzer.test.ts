import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), products: vi.fn(), paid: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { adAccount: { findMany: mocks.accounts }, wooProduct: { findMany: mocks.products } } }));
vi.mock('../../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../../ads/GoogleAdsService', () => ({ GoogleAdsService: { getSearchKeywords: mocks.paid } }));
import { NegativeKeywordAnalyzer } from './NegativeKeywordAnalyzer';
const keyword = { campaignId: 'campaign', campaignName: 'Campaign', adGroupId: 'group', keywordId: 'kw', keywordText: 'unrelated query', matchType: 'BROAD', spend: 29, clicks: 10, conversions: 0, ctr: 5, cpc: 2.9, currency: 'AUD', dateStart: '2026-09-19', dateStop: '2026-10-17' };
beforeEach(() => { vi.resetAllMocks(); mocks.accounts.mockResolvedValue([{ id: 'ad-account' }]); mocks.products.mockResolvedValue([{ name: 'HP printer', sku: 'HP-1' }]); mocks.paid.mockResolvedValue([keyword]); });
describe('negative keyword recommendation safeguards', () => {
    it('withholds recommendations when catalog lookup fails or provides no usable words', async () => {
        mocks.products.mockRejectedValueOnce(new Error('Database unavailable')); await expect(NegativeKeywordAnalyzer.analyze('tenant')).rejects.toThrow('Database unavailable');
        mocks.products.mockResolvedValue([]); await expect(NegativeKeywordAnalyzer.analyze('tenant')).rejects.toThrow('withheld');
    });
    it('propagates provider failures instead of producing partial analysis', async () => {
        mocks.paid.mockRejectedValue(new Error('Unavailable')); await expect(NegativeKeywordAnalyzer.analyze('tenant')).rejects.toThrow('Unavailable');
    });
    it('preserves ad-account scope and discloses currency and heuristic limits', async () => {
        const result = await NegativeKeywordAnalyzer.analyze('tenant');
        expect(result.currency).toBe('AUD'); expect(result.suggestions[0].action).toMatchObject({ adAccountId: 'ad-account', campaignId: 'campaign' });
        expect(result.suggestions[0].explanation).toContain('not a measured relevance score'); expect(result.suggestions[0].explanation).toContain('AUD 29.00');
        expect(result.suggestions[0].confidence).toBeLessThanOrEqual(60); expect(result.summary.estimatedMonthlySavings).toBe(30);
        expect(mocks.paid).toHaveBeenCalledWith('ad-account', 28, 500, { strict: true });
    });
    it('uses stable distinct IDs for identical keywords in different ad accounts', async () => {
        mocks.accounts.mockResolvedValue([{ id: 'first' }, { id: 'second' }]);
        const result = await NegativeKeywordAnalyzer.analyze('tenant'); expect(result.suggestions).toHaveLength(2); expect(new Set(result.suggestions.map(item => item.id)).size).toBe(2);
    });
    it('does not classify short brand words or unicode catalog words as irrelevant', async () => {
        mocks.products.mockResolvedValue([{ name: 'HP café printer', sku: '' }]); mocks.paid.mockResolvedValue([{ ...keyword, keywordText: 'HP café' }]);
        expect((await NegativeKeywordAnalyzer.analyze('tenant')).suggestions).toEqual([]);
    });
    it('rejects mixed currencies and incomplete capped responses', async () => {
        mocks.paid.mockResolvedValue([keyword, { ...keyword, keywordId: 'other', currency: 'USD' }]); await expect(NegativeKeywordAnalyzer.analyze('tenant')).rejects.toThrow('one known currency');
        mocks.paid.mockResolvedValue(Array.from({ length: 500 }, () => keyword)); await expect(NegativeKeywordAnalyzer.analyze('tenant')).rejects.toThrow('analysis limit');
    });
});
