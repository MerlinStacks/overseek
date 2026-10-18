import { describe, expect, it, vi } from 'vitest';
import { RecommendationEngine } from './RecommendationEngine';
import { getCampaignType } from '../AdContext';
import type { CampaignInsight } from '../../ads/types';

vi.mock('../../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../../utils/logger', () => ({ Logger: { warn: vi.fn(), debug: vi.fn() } }));

const campaign: CampaignInsight = {
    campaignId: '1', campaignName: '[2025] Shopping - Embroidery', status: 'ENABLED',
    spend: 572.64, impressions: 19200, clicks: 214, conversions: 17,
    conversionsValue: 1248, roas: 2.18, ctr: 1.11, cpc: 2.68, cpa: 33.68,
    currency: 'AUD', dateStart: '2026-10-09', dateStop: '2026-10-15',
};

describe('campaign type recommendations', () => {
    it.each(['SHOPPING', 'SEARCH', 'DISPLAY', 'UNKNOWN', undefined])(
        'does not issue PMax advice for channel %s', advertisingChannelType => {
            const recommendations = RecommendationEngine.generateFromCampaigns([
                { ...campaign, conversions: 10, advertisingChannelType },
            ], 'google');
            expect(recommendations.some(rec => rec.id.startsWith('google_pmax'))).toBe(false);
        }
    );

    it('uses the actual channel over a misleading campaign name', () => {
        expect(getCampaignType('Shopping - Embroidery', 'SEARCH')).toBe('search');
        expect(getCampaignType('PMax - Embroidery', 'SHOPPING')).toBe('shopping');
        expect(getCampaignType('Shopping - Embroidery', 'PERFORMANCE_MAX')).toBe('performance_max');
        expect(getCampaignType('Shopping - Embroidery', 'UNKNOWN')).toBe('unknown');
    });

    it('keeps name-based fallbacks distinct for Shopping and PMax', () => {
        expect(getCampaignType('Shopping - Embroidery')).toBe('shopping');
        expect(getCampaignType('PMax - Embroidery')).toBe('performance_max');
    });

    it('does not assume an unknown launch date means learning', () => {
        const recommendations = RecommendationEngine.generateFromCampaigns([
            { ...campaign, advertisingChannelType: 'PERFORMANCE_MAX' },
        ], 'google');
        expect(recommendations.some(rec => rec.id.startsWith('google_pmax_learning'))).toBe(false);
    });

    it('still provides low-volume advice for confirmed PMax campaigns', () => {
        const recommendations = RecommendationEngine.generateFromCampaigns([
            { ...campaign, conversions: 10, advertisingChannelType: 'PERFORMANCE_MAX' },
        ], 'google');
        expect(recommendations.some(rec => rec.id.startsWith('google_pmax_low_conversions'))).toBe(true);
    });
});
