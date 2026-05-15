import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: {
        wooProduct: { findMany: vi.fn(), count: vi.fn() },
        wooPage: { findMany: vi.fn(), count: vi.fn() },
        wooBlogPost: { findMany: vi.fn(), count: vi.fn() },
        adAccount: { count: vi.fn() },
        searchConsoleAccount: { count: vi.fn() },
        recommendationLog: { findMany: vi.fn(), createMany: vi.fn() },
    },
    keywordService: {
        getLowHangingFruit: vi.fn(),
        getAIRecommendations: vi.fn(),
    },
    searchAdsService: {
        getCorrelation: vi.fn(),
    },
    negativeKeywordAnalyzer: {
        analyze: vi.fn(),
    },
    logger: {
        warn: vi.fn(),
    },
}));

vi.mock('../../utils/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('../../utils/logger', () => ({ Logger: mocks.logger }));
vi.mock('../search-console/KeywordRecommendationService', () => ({
    KeywordRecommendationService: mocks.keywordService,
}));
vi.mock('../ads/SearchToAdsIntelligenceService', () => ({
    SearchToAdsIntelligenceService: mocks.searchAdsService,
}));
vi.mock('../tools/analyzers/NegativeKeywordAnalyzer', () => ({
    NegativeKeywordAnalyzer: mocks.negativeKeywordAnalyzer,
}));

import { AiManagerService } from './AiManagerService';

describe('AiManagerService', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.prisma.wooProduct.findMany.mockResolvedValue([]);
        mocks.prisma.wooPage.findMany.mockResolvedValue([]);
        mocks.prisma.wooBlogPost.findMany.mockResolvedValue([]);
        mocks.prisma.recommendationLog.findMany.mockResolvedValue([]);
        mocks.prisma.recommendationLog.createMany.mockResolvedValue({ count: 0 });

        mocks.keywordService.getLowHangingFruit.mockResolvedValue([]);
        mocks.keywordService.getAIRecommendations.mockResolvedValue([]);

        mocks.searchAdsService.getCorrelation.mockResolvedValue({
            overlap: [],
            organicOnly: [],
            paidOnlyCount: 0,
            summary: {
                totalOrganicQueries: 0,
                totalPaidKeywords: 0,
                overlapCount: 0,
                organicOnlyCount: 0,
                estimatedTotalWastedSpend: 0,
                estimatedUntappedValue: 0,
            },
        });

        mocks.negativeKeywordAnalyzer.analyze.mockResolvedValue({
            summary: { negativeCandidates: 0, estimatedMonthlySavings: 0 },
        });
    });

    it('uses low-hanging query in the keyword title', async () => {
        mocks.keywordService.getLowHangingFruit.mockResolvedValue([
            { query: 'blue widgets', position: 8, impressions: 210, clicks: 16, ctr: 7.6, estimatedUpside: 22, suggestedAction: 'update heading' },
        ]);

        await AiManagerService.generateSuggestions('acc-1');

        const payload = mocks.prisma.recommendationLog.createMany.mock.calls[0][0];
        const keywordCard = payload.data.find((r: any) => r.recommendationId.startsWith('ai_manager_seo_fix_'));

        expect(keywordCard.campaignName).toContain('blue widgets');
        expect(keywordCard.campaignName).not.toContain('undefined');
    });

    it('includes overlap keywords in paid-organic cannibalization recommendation', async () => {
        mocks.searchAdsService.getCorrelation.mockResolvedValue({
            overlap: [
                { query: 'buy red mug', cannibalizationScore: 78 },
                { query: 'custom red mug', cannibalizationScore: 65 },
                { query: 'mug', cannibalizationScore: 25 },
            ],
            organicOnly: [],
            paidOnlyCount: 0,
            summary: {
                totalOrganicQueries: 30,
                totalPaidKeywords: 20,
                overlapCount: 3,
                organicOnlyCount: 0,
                estimatedTotalWastedSpend: 420,
                estimatedUntappedValue: 0,
            },
        });

        await AiManagerService.generateSuggestions('acc-1');

        const payload = mocks.prisma.recommendationLog.createMany.mock.calls[0][0];
        const cannibalizationCard = payload.data.find((r: any) => r.recommendationId.startsWith('ai_manager_ads_opt_waste_'));

        expect(cannibalizationCard.campaignName).toContain('buy red mug');
        expect(cannibalizationCard.text).toContain('buy red mug');
        expect(cannibalizationCard.text).toContain('custom red mug');
        expect(cannibalizationCard.text).not.toContain('Top overlapping paid keywords: mug');
        expect(cannibalizationCard.dataPoints.some((p: string) => p.includes('Keywords: buy red mug, custom red mug'))).toBe(true);
    });

    it('sorts suggestions by impact before saving', async () => {
        mocks.keywordService.getLowHangingFruit.mockResolvedValue([
            { query: 'low upside term', position: 12, impressions: 60, clicks: 2, ctr: 3, estimatedUpside: 3, suggestedAction: 'tweak title' },
        ]);

        mocks.searchAdsService.getCorrelation.mockResolvedValue({
            overlap: [{ query: 'expensive overlap term', cannibalizationScore: 82 }],
            organicOnly: [],
            paidOnlyCount: 0,
            summary: {
                totalOrganicQueries: 40,
                totalPaidKeywords: 18,
                overlapCount: 1,
                organicOnlyCount: 0,
                estimatedTotalWastedSpend: 2400,
                estimatedUntappedValue: 0,
            },
        });

        await AiManagerService.generateSuggestions('acc-1');

        const payload = mocks.prisma.recommendationLog.createMany.mock.calls[0][0];
        expect(payload.data[0].recommendationId).toMatch(/^ai_manager_ads_opt_waste_/);
    });
});
