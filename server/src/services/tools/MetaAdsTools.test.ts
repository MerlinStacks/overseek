import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), insights: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { adAccount: { findMany: mocks.accounts } } }));
vi.mock('../ads', () => ({ AdsService: { getMetaCampaignInsights: mocks.insights } }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));
import { MetaAdsTools } from './MetaAdsTools';
const campaign = (currency = 'USD') => ({ campaignId: 'c1', campaignName: 'Campaign', currency, spend: 100, clicks: 20, impressions: 1000, conversions: 4, conversionsValue: 400 });
beforeEach(() => {
    vi.resetAllMocks();
    mocks.accounts.mockResolvedValue([{ id: 'a1', name: 'Account', currency: 'USD' }]);
    mocks.insights.mockResolvedValue([campaign()]);
});
describe('Meta ads analysis', () => {
    it('preserves valid metrics with explicit currency and period context', async () => {
        const result = await MetaAdsTools.analyzeMetaAdsCampaigns('tenant-1', 7);
        expect(result).toEqual(expect.objectContaining({ partial_data: false, summary: expect.objectContaining({ total_spend: 'USD 100.00', overall_roas: '4.00x', days: 7, currency: 'USD' }) }));
        expect(mocks.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'tenant-1', platform: 'META' } }));
        expect(mocks.insights).toHaveBeenCalledWith('a1', 7);
    });
    it('does not sum or rank monetary amounts across currencies', async () => {
        mocks.accounts.mockResolvedValue([{ id: 'a1', currency: 'USD' }, { id: 'a2', currency: 'AUD' }]);
        mocks.insights.mockResolvedValueOnce([campaign('USD')]).mockResolvedValueOnce([{ ...campaign('AUD'), spend: 200 }]);
        const result = await MetaAdsTools.analyzeMetaAdsCampaigns('tenant-1');
        expect(result).toEqual(expect.objectContaining({
            summary: expect.objectContaining({ currency: 'MULTIPLE', total_spend: expect.stringContaining('mixed currencies') }), top_spenders: [],
            by_currency: { USD: expect.objectContaining({ summary: expect.objectContaining({ total_spend: 'USD 100.00' }) }),
                AUD: expect.objectContaining({ summary: expect.objectContaining({ total_spend: 'AUD 200.00' }) }) },
        }));
    });
    it('marks partial account coverage explicitly', async () => {
        mocks.accounts.mockResolvedValue([{ id: 'a1', currency: 'USD' }, { id: 'a2', currency: 'USD' }]);
        mocks.insights.mockResolvedValueOnce([campaign()]).mockRejectedValueOnce(new Error('Provider unavailable'));
        expect(await MetaAdsTools.analyzeMetaAdsCampaigns('tenant-1')).toEqual(expect.objectContaining({ partial_data: true, failed_accounts: ['a2'] }));
    });
    it('normalizes numeric strings and excludes non-finite or malformed campaign rows', async () => {
        mocks.insights.mockResolvedValue([{ ...campaign(), spend: '100' }, { ...campaign(), spend: Infinity }, null]);
        expect(await MetaAdsTools.analyzeMetaAdsCampaigns('tenant-1')).toEqual(expect.objectContaining({ partial_data: true, excluded_campaigns: 2,
            summary: expect.objectContaining({ total_campaigns: 1, total_spend: 'USD 100.00' }) }));
    });
    it('does not invent a reporting currency', async () => {
        mocks.accounts.mockResolvedValue([{ id: 'a1', currency: null }]);
        mocks.insights.mockResolvedValue([{ ...campaign(), currency: null }]);
        expect(await MetaAdsTools.analyzeMetaAdsCampaigns('tenant-1')).toContain('unavailable or invalid');
    });
    it.each([0, -1, 1.5, Infinity, 366, '30'])('rejects invalid day windows before querying: %s', async days => {
        expect(await MetaAdsTools.analyzeMetaAdsCampaigns('tenant-1', days as number)).toContain('Days must');
        expect(mocks.accounts).not.toHaveBeenCalled();
    });
    it('requires tenant context and preserves no-account messaging', async () => {
        expect(await MetaAdsTools.analyzeMetaAdsCampaigns('')).toBe('Account ID required.');
        mocks.accounts.mockResolvedValue([]);
        expect(await MetaAdsTools.analyzeMetaAdsCampaigns('tenant-1')).toContain('No Meta Ads accounts connected');
    });
});
