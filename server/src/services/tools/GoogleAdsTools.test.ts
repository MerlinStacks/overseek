import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ accounts: vi.fn(), campaigns: vi.fn(), products: vi.fn(), keywords: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { adAccount: { findMany: m.accounts } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../ads', () => ({ AdsService: { getGoogleCampaignInsights: m.campaigns, getGoogleShoppingProducts: m.products, getGoogleSearchKeywords: m.keywords } }));
import { GoogleAdsTools } from './GoogleAdsTools';
const row = (currency = 'AUD') => ({ campaignId: 'c', campaignName: 'Campaign', spend: 10, impressions: 100, clicks: 10, conversions: 0.25, conversionsValue: 5, roas: 0.5, currency });
beforeEach(() => { vi.resetAllMocks(); m.accounts.mockResolvedValue([{ id: 'a' }]); m.campaigns.mockResolvedValue([row()]); m.products.mockResolvedValue([]); m.keywords.mockResolvedValue([]); });
describe('coverage-aware currency-safe ad tools', () => {
    it('preserves fractional attribution and explicit currency', async () => { const result = await GoogleAdsTools.analyzeGoogleAdsCampaigns('tenant'); expect(result).toMatchObject({ currency: 'AUD', summary: { total_spend: 'AUD 10.00', total_conversions: 0.25 } }); });
    it('exposes missing supplemental sections instead of pretending analysis is complete', async () => { m.products.mockRejectedValue(new Error('Unavailable')); expect(await GoogleAdsTools.analyzeGoogleAdsCampaigns('tenant')).toMatchObject({ partial_data: true, coverage: expect.arrayContaining([expect.objectContaining({ section: 'shopping', status: 'unavailable' })]) }); });
    it('does not aggregate incompatible currencies or malformed monetary values', async () => {
        m.campaigns.mockResolvedValue([row('AUD'), row('USD')]); expect(await GoogleAdsTools.analyzeGoogleAdsCampaigns('tenant')).toContain('mixed currencies');
        m.campaigns.mockResolvedValue([{ ...row(), spend: NaN }]); expect(await GoogleAdsTools.analyzeGoogleAdsCampaigns('tenant')).toContain('No campaign data');
    });
});
