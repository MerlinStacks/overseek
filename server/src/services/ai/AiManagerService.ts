import { KeywordRecommendationService } from '../search-console/KeywordRecommendationService';
import { SearchToAdsIntelligenceService } from '../ads/SearchToAdsIntelligenceService';
import { NegativeKeywordAnalyzer } from '../tools/analyzers/NegativeKeywordAnalyzer';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import type { LowHangingFruit, AIKeywordRecommendation } from '../search-console/KeywordRecommendationService';

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
    impactScore?: number;
}

const toNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const computeImpactScore = (suggestion: BuiltSuggestion): number => {
    const priorityWeight = suggestion.priority === 1 ? 60 : suggestion.priority === 2 ? 35 : 15;
    const confidenceWeight = Math.round((suggestion.confidence || 0) * 0.25);
    const dataPointWeight = (suggestion.dataPoints || []).reduce((score, point) => {
        const normalized = point.toLowerCase();
        const numberMatch = point.match(/-?\d+(?:\.\d+)?/);
        const numeric = numberMatch ? Number(numberMatch[0]) : 0;

        if (normalized.includes('estimated wasted spend')) return score + Math.min(numeric, 10000) / 40;
        if (normalized.includes('estimated monthly savings')) return score + Math.min(numeric, 10000) / 45;
        if (normalized.includes('estimated upside')) return score + Math.min(numeric, 5000) / 35;
        if (normalized.includes('impressions')) return score + Math.min(numeric, 50000) / 600;
        if (normalized.includes('overlap keywords')) return score + Math.min(numeric * 3, 45);
        return score;
    }, 0);

    return Math.round((priorityWeight + confidenceWeight + dataPointWeight) * 100) / 100;
};

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

            lowHanging.slice(0, 4).forEach((item: LowHangingFruit, index: number) => {
                const keyword = item.query?.trim();
                if (!keyword) return;
                suggestions.push({
                    recommendationId: `ai_manager_seo_fix_${now}_${index}`,
                    title: `Target low-hanging keyword: ${keyword}`,
                    text: `Create or update content for "${keyword}" with focused H2 structure, stronger title intent match, and improved meta description to capture available clicks. Current position is ${Math.round(item.position)} with estimated upside of ${Math.max(0, Math.round(item.estimatedUpside))} clicks.`,
                    type: 'SEO_FIX',
                    source: 'SEARCH_CONSOLE',
                    priority: 1,
                    confidence: 82,
                    dataPoints: [
                        `Current position: ${item.position ?? 'n/a'}`,
                        `Impressions: ${item.impressions ?? 0}`,
                        `Clicks: ${item.clicks ?? 0}`,
                        `Estimated upside: ${Math.max(0, Math.round(item.estimatedUpside ?? 0))}`,
                    ],
                    tags: ['seo', 'keyword', 'search-console'],
                });
            });

            aiRecommendations.slice(0, 3).forEach((item: AIKeywordRecommendation, index: number) => {
                suggestions.push({
                    recommendationId: `ai_manager_seo_ai_${now}_${index}`,
                    title: item.title || `SEO opportunity ${index + 1}`,
                    text: item.description || 'Refine on-page content for emerging search demand.',
                    type: 'SEO_FIX',
                    source: 'SEARCH_CONSOLE',
                    priority: 2,
                    confidence: 70,
                    dataPoints: item.expectedImpact ? [item.expectedImpact] : [],
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
                const overlapKeywords = (correlation.overlap || [])
                    .filter((o) => toNumber(o?.cannibalizationScore) >= 40)
                    .slice(0, 3)
                    .map((o) => o.query)
                    .filter(Boolean);

                const overlapText = overlapKeywords.length > 0
                    ? `Top overlapping paid keywords: ${overlapKeywords.join(', ')}.`
                    : 'Review overlapping paid keywords that already rank organically.';

                const topKeywordsLabel = overlapKeywords.length > 0 ? ` (${overlapKeywords.slice(0, 2).join(', ')})` : '';

                suggestions.push({
                    recommendationId: `ai_manager_ads_opt_waste_${now}`,
                    title: `Reduce paid-organic cannibalization waste${topKeywordsLabel}`,
                    text: `${overlapText} Rewrite ad coverage to focus on incremental-value terms.`,
                    type: 'ADS_OPTIMIZATION',
                    source: 'GOOGLE_ADS',
                    priority: 1,
                    confidence: 80,
                    dataPoints: [
                        `Overlap keywords: ${correlation.summary.overlapCount ?? 0}`,
                        `Estimated wasted spend: ${Math.round(correlation.summary.estimatedTotalWastedSpend ?? 0)}`,
                        ...(overlapKeywords.length > 0 ? [`Keywords: ${overlapKeywords.join(', ')}`] : []),
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
            try {
                const [productCount, pageCount, postCount, adAccountCount, scAccountCount] = await Promise.all([
                    prisma.wooProduct.count({ where: { accountId } }),
                    prisma.wooPage.count({ where: { accountId } }),
                    prisma.wooBlogPost.count({ where: { accountId } }),
                    prisma.adAccount.count({ where: { accountId } }),
                    prisma.searchConsoleAccount.count({ where: { accountId } }),
                ]);

                suggestions.push({
                    recommendationId: `ai_manager_content_plan_${now}`,
                    title: 'Build a weekly content optimization plan',
                    text: 'Prioritize the lowest-converting product and landing pages for SEO rewrites first, then schedule one blog refresh per week to expand long-tail coverage.',
                    type: 'CONTENT_STRATEGY',
                    source: 'COMBINED',
                    priority: 2,
                    confidence: 66,
                    dataPoints: [
                        `Products: ${productCount}`,
                        `Pages: ${pageCount}`,
                        `Blog posts: ${postCount}`,
                    ],
                    tags: ['strategy', 'content', 'baseline'],
                });

                suggestions.push({
                    recommendationId: `ai_manager_integration_plan_${now}`,
                    title: 'Strengthen signal quality for AI suggestions',
                    text: 'Ensure Search Console and ad accounts stay connected, then run weekly refreshes so recommendations can prioritize terms with clear opportunity and spend impact.',
                    type: 'DATA_QUALITY',
                    source: 'COMBINED',
                    priority: 3,
                    confidence: 64,
                    dataPoints: [
                        `Search Console accounts: ${scAccountCount}`,
                        `Ad accounts: ${adAccountCount}`,
                    ],
                    tags: ['integrations', 'baseline'],
                });
            } catch (error) {
                Logger.warn('[AiManagerService] Failed baseline fallback generation', { accountId, error });
            }
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
        const seenRecommendationIds = new Set<string>();
        const seenTitles = new Set<string>();

        const unique = suggestions
            .filter((s) => !existingText.has(s.text.trim().toLowerCase()))
            .filter((s) => {
                const normalizedId = s.recommendationId.trim().toLowerCase();
                const normalizedTitle = s.title.trim().toLowerCase();
                if (seenRecommendationIds.has(normalizedId) || seenTitles.has(normalizedTitle)) {
                    return false;
                }
                seenRecommendationIds.add(normalizedId);
                seenTitles.add(normalizedTitle);
                return true;
            })
            .map((s) => ({ ...s, impactScore: computeImpactScore(s) }))
            .sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0))
            .slice(0, 20);

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
