import { KeywordRecommendationService } from '../search-console/KeywordRecommendationService';
import { SearchToAdsIntelligenceService } from '../ads/SearchToAdsIntelligenceService';
import { NegativeKeywordAnalyzer } from '../tools/analyzers/NegativeKeywordAnalyzer';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

interface BuiltSuggestion {
    recommendationId: string;
    title: string;
    text: string;
    type: string;
    source: string;
    priority: 1 | 2 | 3;
    confidence: number;
    dataPoints?: string[];
    tags?: string[];
}

export class AiManagerService {
    static async generateSuggestions(accountId: string): Promise<{ created: number }> {
        const suggestions: BuiltSuggestion[] = [];
        const now = Date.now();

        try {
            const [products, pages, posts] = await Promise.all([
                prisma.wooProduct.findMany({
                    where: { accountId, seoScore: { lt: 65 } },
                    select: { id: true, name: true, seoScore: true },
                    orderBy: { updatedAt: 'desc' },
                    take: 4,
                }),
                prisma.wooPage.findMany({
                    where: { accountId, seoScore: { lt: 65 } },
                    select: { id: true, title: true, seoScore: true },
                    orderBy: { dateModified: 'desc' },
                    take: 3,
                }),
                prisma.wooBlogPost.findMany({
                    where: { accountId, seoScore: { lt: 65 } },
                    select: { id: true, title: true, seoScore: true },
                    orderBy: { dateModified: 'desc' },
                    take: 3,
                }),
            ]);

            products.forEach((p, index) => {
                suggestions.push({
                    recommendationId: `ai_manager_product_rewrite_${now}_${index}`,
                    title: `Rewrite product content: ${p.name}`,
                    text: `Improve this product's title and description around one primary buyer intent keyword. Keep claims factual, add stronger feature-benefit mapping, and tighten first 120 words for search snippets.`,
                    type: 'PRODUCT_REWRITE',
                    source: 'SEO_CONTENT',
                    priority: 2,
                    confidence: 74,
                    dataPoints: [`Current SEO score: ${p.seoScore ?? 0}`, 'Target score: 75+'],
                    tags: ['product', 'rewrite', 'seo'],
                });
            });

            pages.forEach((p, index) => {
                suggestions.push({
                    recommendationId: `ai_manager_page_rewrite_${now}_${index}`,
                    title: `Refresh page SEO copy: ${p.title}`,
                    text: `Refactor headings and opening copy to align with top transactional queries. Add concise FAQ-style sections to improve relevance and click-through potential.`,
                    type: 'PAGE_REWRITE',
                    source: 'SEO_CONTENT',
                    priority: 2,
                    confidence: 72,
                    dataPoints: [`Current SEO score: ${p.seoScore ?? 0}`],
                    tags: ['page', 'rewrite', 'seo'],
                });
            });

            posts.forEach((p, index) => {
                suggestions.push({
                    recommendationId: `ai_manager_blog_rewrite_${now}_${index}`,
                    title: `Update blog post for ranking lift: ${p.title}`,
                    text: `Expand this post with clearer keyword intent coverage, stronger internal linking anchors, and updated examples to improve position stability.`,
                    type: 'BLOG_REWRITE',
                    source: 'SEO_CONTENT',
                    priority: 3,
                    confidence: 69,
                    dataPoints: [`Current SEO score: ${p.seoScore ?? 0}`],
                    tags: ['blog', 'rewrite', 'seo'],
                });
            });
        } catch (error) {
            Logger.warn('[AiManagerService] Failed content suggestion pass', { accountId, error });
        }

        try {
            const [lowHanging, aiRecommendations] = await Promise.all([
                KeywordRecommendationService.getLowHangingFruit(accountId),
                KeywordRecommendationService.getAIRecommendations(accountId),
            ]);

            lowHanging.slice(0, 4).forEach((item: any, index: number) => {
                suggestions.push({
                    recommendationId: `ai_manager_seo_fix_${now}_${index}`,
                    title: `Target low-hanging keyword: ${item.keyword}`,
                    text: `Create or update content for this keyword with focused H2 structure, stronger title intent match, and improved meta description to capture available clicks.`,
                    type: 'SEO_FIX',
                    source: 'SEARCH_CONSOLE',
                    priority: 1,
                    confidence: 82,
                    dataPoints: [
                        `Current position: ${item.position ?? 'n/a'}`,
                        `Impressions: ${item.impressions ?? 0}`,
                        `Clicks: ${item.clicks ?? 0}`,
                    ],
                    tags: ['seo', 'keyword', 'search-console'],
                });
            });

            aiRecommendations.slice(0, 3).forEach((item: any, index: number) => {
                suggestions.push({
                    recommendationId: `ai_manager_seo_ai_${now}_${index}`,
                    title: item.title || `SEO opportunity ${index + 1}`,
                    text: item.recommendation || item.description || 'Refine on-page content for emerging search demand.',
                    type: 'SEO_FIX',
                    source: 'SEARCH_CONSOLE',
                    priority: 2,
                    confidence: 70,
                    dataPoints: item.reason ? [item.reason] : [],
                    tags: ['seo', 'ai'],
                });
            });
        } catch (error) {
            Logger.warn('[AiManagerService] Failed search console suggestion pass', { accountId, error });
        }

        try {
            const [correlation, negativeKeywords] = await Promise.all([
                SearchToAdsIntelligenceService.getCorrelation(accountId),
                NegativeKeywordAnalyzer.analyze(accountId),
            ]);

            if (correlation?.summary?.estimatedTotalWastedSpend > 0) {
                suggestions.push({
                    recommendationId: `ai_manager_ads_opt_waste_${now}`,
                    title: 'Reduce paid-organic cannibalization waste',
                    text: 'Review overlapping paid keywords that already rank organically and rewrite ad coverage to focus on incremental-value terms.',
                    type: 'ADS_OPTIMIZATION',
                    source: 'GOOGLE_ADS',
                    priority: 1,
                    confidence: 80,
                    dataPoints: [
                        `Overlap keywords: ${correlation.summary.overlapCount ?? 0}`,
                        `Estimated wasted spend: ${Math.round(correlation.summary.estimatedTotalWastedSpend ?? 0)}`,
                    ],
                    tags: ['ads', 'google-ads', 'efficiency'],
                });
            }

            if (negativeKeywords?.summary?.negativeCandidates > 0) {
                suggestions.push({
                    recommendationId: `ai_manager_ads_opt_negative_${now}`,
                    title: 'Expand negative keyword strategy',
                    text: 'Review search term quality and add negative keyword groups to stop low-intent spend bleed before scaling budgets.',
                    type: 'ADS_OPTIMIZATION',
                    source: 'GOOGLE_ADS',
                    priority: 2,
                    confidence: 76,
                    dataPoints: [
                        `Negative candidates: ${negativeKeywords.summary.negativeCandidates}`,
                        `Estimated monthly savings: ${Math.round(negativeKeywords.summary.estimatedMonthlySavings ?? 0)}`,
                    ],
                    tags: ['ads', 'negative-keywords'],
                });
            }
        } catch (error) {
            Logger.warn('[AiManagerService] Failed ads suggestion pass', { accountId, error });
        }

        if (suggestions.length === 0) {
            return { created: 0 };
        }

        const existingRecent = await prisma.recommendationLog.findMany({
            where: {
                accountId,
                recommendationId: { startsWith: 'ai_manager_' },
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
            select: { text: true },
        });

        const existingText = new Set(existingRecent.map((r) => r.text.trim().toLowerCase()));
        const unique = suggestions.filter((s) => !existingText.has(s.text.trim().toLowerCase())).slice(0, 20);

        if (unique.length === 0) {
            return { created: 0 };
        }

        await prisma.recommendationLog.createMany({
            data: unique.map((s) => ({
                accountId,
                recommendationId: s.recommendationId,
                text: s.text,
                category: s.type,
                priority: s.priority,
                platform: s.source,
                confidenceScore: s.confidence,
                confidenceLevel: s.confidence >= 80 ? 'high' : s.confidence >= 65 ? 'medium' : 'low',
                campaignName: s.title,
                status: 'pending',
                dataPoints: s.dataPoints ?? [],
                tags: s.tags ?? [],
            })),
        });

        return { created: unique.length };
    }
}
