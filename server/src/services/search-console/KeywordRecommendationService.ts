/**
 * Keyword Recommendation Service
 *
 * Combines Google Search Console data with the WooCommerce product catalog
 * and an AI model to generate actionable SEO keyword recommendations.
 *
 * Three algorithmic analyses + one AI-powered synthesis:
 * 1. Low-hanging fruit — keywords ranking 5-20 with room to grow
 * 2. Keyword gaps — products with no organic search visibility
 * 3. Trending keywords — queries gaining traction period-over-period
 * 4. AI recommendations — strategic synthesis of all data points
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SearchConsoleService, QueryAnalytics, QueryTrend } from './SearchConsoleService';

/** A keyword opportunity with position and estimated impact */
export interface LowHangingFruit {
    query: string;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    /** Estimated additional clicks if position improved to top 3 */
    estimatedUpside: number;
    suggestedAction: string;
}

/** A product category with no organic search coverage */
export interface KeywordGap {
    productName: string;
    productCategory: string;
    /** Search queries that relate to this product but aren't ranking */
    suggestedKeywords: string[];
    priority: 'high' | 'medium' | 'low';
}

/** AI-generated recommendation */
export interface AIKeywordRecommendation {
    title: string;
    description: string;
    keywords: string[];
    priority: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    expectedImpact: string;
    actionType: 'content' | 'optimization' | 'technical' | 'trend';
}

export class KeywordRecommendationService {

    /**
     * Find low-hanging fruit: keywords ranking positions 5-20 with decent impressions.
     * Why positions 5-20: these are on page 1-2 of Google and can often be pushed higher
     * with focused SEO work, delivering meaningful traffic increases.
     */
    static async getLowHangingFruit(accountId: string): Promise<LowHangingFruit[]> {
        const analytics = await SearchConsoleService.getSearchAnalytics(accountId, {
            days: 28,
            rowLimit: 1000
        });

        if (analytics.length === 0) return [];

        return analytics
            .filter(q => q.position >= 5 && q.position <= 20 && q.impressions >= 50)
            .map(q => {
                // Estimate upside: if position improved to ~3, CTR would be ~15-20%
                const estimatedCtr = 0.15;
                const currentCtr = q.ctr / 100;
                const additionalClicks = Math.round(q.impressions * (estimatedCtr - currentCtr));

                return {
                    query: q.query,
                    position: q.position,
                    impressions: q.impressions,
                    clicks: q.clicks,
                    ctr: q.ctr,
                    estimatedUpside: Math.max(0, additionalClicks),
                    suggestedAction: getSuggestedAction(q)
                };
            })
            .sort((a, b) => b.estimatedUpside - a.estimatedUpside)
            .slice(0, 25);
    }

    /**
     * Find keyword gaps: products in the catalog that have no organic visibility.
     * Cross-references WooCommerce product names and categories against
     * Search Console queries to find blind spots.
     */
    static async getKeywordGaps(accountId: string): Promise<KeywordGap[]> {
        const [analytics, products] = await Promise.all([
            SearchConsoleService.getSearchAnalytics(accountId, { days: 28, rowLimit: 1000 }),
            prisma.wooProduct.findMany({
                where: { accountId, stockStatus: 'instock' },
                select: { name: true, rawData: true, price: true }
            })
        ]);

        if (products.length === 0) return [];

        // Build a set of all queries we already rank for (normalized)
        const rankedQueries = new Set(analytics.map(q => q.query.toLowerCase()));

        const gaps: KeywordGap[] = [];

        for (const product of products) {
            const rawData = product.rawData as any;
            const categories: string[] = (rawData?.categories || []).map((c: any) => c.name).filter(Boolean);
            const productName = product.name;

            // Generate candidate search terms from product name and categories
            const candidates = generateSearchCandidates(productName, categories);
            const missingKeywords = candidates.filter(kw => !rankedQueries.has(kw.toLowerCase()));

            if (missingKeywords.length > 0) {
                const priority = product.price && Number(product.price) > 100 ? 'high'
                    : product.price && Number(product.price) > 30 ? 'medium'
                        : 'low';

                gaps.push({
                    productName,
                    productCategory: categories[0] || 'Uncategorized',
                    suggestedKeywords: missingKeywords.slice(0, 5),
                    priority
                });
            }
        }

        // Sort by priority (high first)
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return gaps
            .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
            .slice(0, 20);
    }

    /**
     * Find trending keywords: queries with significant impression growth.
     * Surfaces emerging search interest that could represent product demand.
     */
    static async getTrendingKeywords(accountId: string): Promise<QueryTrend[]> {
        const trends = await SearchConsoleService.getSearchTrends(accountId, 28);

        // Filter for meaningful growth (>30% impression increase, decent volume)
        return trends
            .filter(t => t.impressionGrowthPct >= 30 && t.currentImpressions >= 20)
            .slice(0, 25);
    }

    /**
     * Generate AI-powered strategic recommendations.
     * Sends a structured prompt to the AI model with all data points.
     */
    static async getAIRecommendations(accountId: string): Promise<AIKeywordRecommendation[]> {
        try {
            const [lowHanging, trends, topQueries, products] = await Promise.all([
                this.getLowHangingFruit(accountId),
                this.getTrendingKeywords(accountId),
                SearchConsoleService.getSearchAnalytics(accountId, { days: 28, rowLimit: 50 }),
                prisma.wooProduct.findMany({
                    where: { accountId, stockStatus: 'instock' },
                    select: { name: true, rawData: true },
                    take: 50
                })
            ]);

            if (topQueries.length === 0) {
                Logger.info('No Search Console data available for AI recommendations', { accountId });
                return [];
            }

            // Get the account's AI model and API key
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { openRouterApiKey: true, aiModel: true }
            });

            if (!account?.openRouterApiKey) {
                Logger.warn('No OpenRouter API key configured for AI recommendations', { accountId });
                return [];
            }

            const productNames = products.map(p => p.name);
            const categories = [...new Set(
                products.flatMap(p => {
                    const raw = p.rawData as any;
                    return (raw?.categories || []).map((c: any) => c.name).filter(Boolean);
                })
            )];

            const prompt = buildAIPrompt(topQueries, lowHanging, trends, productNames, categories);
            const model = account.aiModel || 'openai/gpt-4o';

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${account.openRouterApiKey}`,
                    'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173'
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: 'You are an expert SEO strategist for e-commerce stores. Respond ONLY with valid JSON.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 2000,
                    response_format: { type: 'json_object' }
                })
            });

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            if (!content) {
                Logger.warn('Empty AI response for keyword recommendations', { accountId });
                return [];
            }

            const parsed = JSON.parse(content);
            const raw = parsed.recommendations || [];

            // Validate shape: AI can return anything, don't let malformed data reach the client
            return raw
                .filter((r: any) =>
                    typeof r.title === 'string' &&
                    typeof r.description === 'string' &&
                    Array.isArray(r.keywords)
                )
                .slice(0, 10) as AIKeywordRecommendation[];

        } catch (error) {
            Logger.error('Failed to generate AI keyword recommendations', { error, accountId });
            return [];
        }
    }
}

/**
 * Generate suggested action text based on query metrics.
 */
function getSuggestedAction(q: QueryAnalytics): string {
    if (q.position >= 5 && q.position <= 10) {
        return 'Optimize existing page content and meta tags to push into top 3';
    }
    if (q.position > 10 && q.position <= 15) {
        return 'Create or improve dedicated content targeting this query';
    }
    return 'Build a focused landing page or blog post around this topic';
}

/**
 * Generate candidate search terms from a product name and categories.
 * Extracts meaningful n-grams that users might search for.
 */
function generateSearchCandidates(productName: string, categories: string[]): string[] {
    const candidates: string[] = [];

    // Normalized product name as a search term
    const cleanName = productName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (cleanName.length > 3) candidates.push(cleanName);

    // Individual significant words from product name (3+ chars)
    const words = cleanName.split(/\s+/).filter(w => w.length >= 4);
    for (const word of words) {
        if (!STOP_WORDS.has(word)) candidates.push(word);
    }

    // 2-word combinations from product name
    for (let i = 0; i < words.length - 1; i++) {
        if (!STOP_WORDS.has(words[i]) && !STOP_WORDS.has(words[i + 1])) {
            candidates.push(`${words[i]} ${words[i + 1]}`);
        }
    }

    // Category names
    for (const cat of categories) {
        const cleanCat = cat.toLowerCase().trim();
        if (cleanCat.length > 2) candidates.push(cleanCat);

        // "buy [category]" pattern
        candidates.push(`buy ${cleanCat}`);
    }

    return [...new Set(candidates)];
}

/** Common stop words to exclude from candidate generation */
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have',
    'are', 'was', 'were', 'been', 'being', 'does', 'will', 'would',
    'could', 'should', 'into', 'over', 'each', 'only', 'very', 'pack'
]);

/**
 * Build the structured prompt for the AI model.
 */
function buildAIPrompt(
    topQueries: QueryAnalytics[],
    lowHanging: LowHangingFruit[],
    trends: QueryTrend[],
    productNames: string[],
    categories: string[]
): string {
    return `Analyze the following SEO data for an e-commerce store and provide keyword recommendations.

## Current Top Search Queries (last 28 days)
${topQueries.slice(0, 30).map(q => `- "${q.query}" — position: ${q.position}, clicks: ${q.clicks}, impressions: ${q.impressions}, CTR: ${q.ctr}%`).join('\n')}

## Low-Hanging Fruit Opportunities (position 5-20)
${lowHanging.slice(0, 15).map(q => `- "${q.query}" — position: ${q.position}, impressions: ${q.impressions}, estimated upside: +${q.estimatedUpside} clicks`).join('\n')}

## Trending Keywords (growing queries)
${trends.slice(0, 15).map(t => `- "${t.query}" — impression growth: +${t.impressionGrowthPct}%, clicks: ${t.currentClicks}, position: ${t.currentPosition}`).join('\n')}

## Product Catalog
Categories: ${categories.join(', ')}
Sample products: ${productNames.slice(0, 20).join(', ')}

## Instructions
Return a JSON object with a "recommendations" array. Each recommendation should have:
- "title": Short descriptive title
- "description": 2-3 sentence explanation of why and what to do
- "keywords": Array of 2-5 target keywords
- "priority": "high", "medium", or "low"
- "effort": "low", "medium", or "high"
- "expectedImpact": One sentence describing potential traffic/revenue impact
- "actionType": "content" (new pages/blogs), "optimization" (improve existing), "technical" (schema/speed), or "trend" (capitalize on trending topics)

Focus on:
1. Quick wins from low-hanging fruit keywords
2. Product categories with missing organic coverage
3. Seasonal or trending opportunities
4. Long-tail keywords with purchase intent

Return 5-8 recommendations sorted by priority. Be specific to this store's products.`;
}
