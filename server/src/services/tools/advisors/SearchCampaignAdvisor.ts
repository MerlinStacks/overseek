/**
 * Search Campaign Advisor
 *
 * Generates actionable recommendations for Google Search campaigns.
 * Focused on keyword opportunities with real revenue projections based on historical data.
 * 
 * Part of AI Marketing Co-Pilot Enhancement - Search Campaign Suggestions.
 */

import { Logger } from '../../../utils/logger';
import { prisma } from '../../../utils/prisma';
import { REVENUE_STATUSES } from '../../../constants/orderStatus';
import {
    ActionableRecommendation,
    KeywordAction,
    BudgetAction
} from '../types/ActionableTypes';
import { AdCopyGenerator } from '../AdCopyGenerator';
import { GoogleAdsService } from '../../ads/GoogleAdsService';

// =============================================================================
// TYPES
// =============================================================================

interface SearchCampaignData {
    id: string;
    name: string;
    spend: number;
    clicks: number;
    impressions: number;
    conversions: number;
    revenue: number;
    roas: number;
    ctr: number;
    cpc: number;
}

interface SearchCampaignAdvisorResult {
    hasData: boolean;
    recommendations: ActionableRecommendation[];
    summary: {
        campaignsAnalyzed: number;
        totalSearchSpend: number;
        avgSearchRoas: number;
        opportunitiesFound: number;
    };
}

// =============================================================================
// ADVISOR
// =============================================================================

export class SearchCampaignAdvisor {

    /**
     * Analyze search campaigns and generate actionable recommendations.
     * Includes:
     * - New search campaign suggestions based on organic/site search data
     * - Budget scaling for high-performing search campaigns
     * - Keyword expansion opportunities
     */
    static async analyze(accountId: string): Promise<SearchCampaignAdvisorResult> {
        const result: SearchCampaignAdvisorResult = {
            hasData: false,
            recommendations: [],
            summary: {
                campaignsAnalyzed: 0,
                totalSearchSpend: 0,
                avgSearchRoas: 0,
                opportunitiesFound: 0
            }
        };

        try {
            // Get Google Ads accounts
            const googleAccounts = await prisma.adAccount.findMany({
                where: { accountId, platform: 'GOOGLE' },
                select: { id: true, name: true }
            });

            if (googleAccounts.length === 0) {
                // No Google Ads = Suggest creating a search campaign
                const suggestNewCampaign = await this.suggestNewSearchCampaign(accountId);
                if (suggestNewCampaign) {
                    result.recommendations.push(suggestNewCampaign);
                    result.hasData = true;
                }
                return result;
            }

            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // Aggregate search campaign performance
            const searchCampaigns: SearchCampaignData[] = [];

            for (const acc of googleAccounts) {
                // Fetch daily account snapshots which contain campaign breakdowns in JSON
                const snapshots = await prisma.adPerformanceSnapshot.findMany({
                    where: {
                        adAccountId: acc.id,
                        date: { gte: thirtyDaysAgo }
                    },
                    select: {
                        date: true,
                        campaignBreakdown: true
                    }
                });

                // Aggregate by campaign from the JSON breakdown
                const campaignMap = new Map<string, SearchCampaignData>();

                for (const snap of snapshots) {
                    if (!snap.campaignBreakdown) continue;

                    const breakdown = snap.campaignBreakdown as Record<string, any>;

                    Object.entries(breakdown).forEach(([campaignId, metrics]) => {
                        const campaignName = metrics.name || metrics.campaignName || 'Unknown Campaign';

                        // Filter for Search campaigns: name contains "Search" or "search", and NOT "Shopping"
                        const isSearch = (campaignName.toLowerCase().includes('search')) &&
                            !campaignName.toLowerCase().includes('shopping');

                        if (isSearch) {
                            const existing = campaignMap.get(campaignId) || {
                                id: campaignId,
                                name: campaignName,
                                spend: 0,
                                clicks: 0,
                                impressions: 0,
                                conversions: 0,
                                revenue: 0,
                                roas: 0,
                                ctr: 0,
                                cpc: 0
                            };

                            existing.spend += Number(metrics.spend || 0);
                            existing.clicks += Number(metrics.clicks || 0);
                            existing.impressions += Number(metrics.impressions || 0);
                            existing.conversions += Number(metrics.conversions || 0);
                            existing.revenue += Number(metrics.revenue || metrics.conversionValue || 0);

                            campaignMap.set(campaignId, existing);
                        }
                    });
                }

                // Calculate derived metrics
                for (const campaign of campaignMap.values()) {
                    campaign.roas = campaign.spend > 0 ? campaign.revenue / campaign.spend : 0;
                    campaign.ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0;
                    campaign.cpc = campaign.clicks > 0 ? campaign.spend / campaign.clicks : 0;

                    if (campaign.spend > 50) { // Only consider campaigns with meaningful spend
                        searchCampaigns.push(campaign);
                    }
                }
            }

            result.summary.campaignsAnalyzed = searchCampaigns.length;
            result.hasData = searchCampaigns.length > 0;

            if (searchCampaigns.length > 0) {
                result.summary.totalSearchSpend = searchCampaigns.reduce((s, c) => s + c.spend, 0);
                result.summary.avgSearchRoas = searchCampaigns.reduce((s, c) => s + c.roas, 0) / searchCampaigns.length;
            }

            // Generate recommendations

            // 1. Scale high-performing search campaigns
            const highPerformers = searchCampaigns
                .filter(c => c.roas >= 3 && c.spend >= 100)
                .sort((a, b) => b.roas - a.roas);

            for (const campaign of highPerformers.slice(0, 3)) {
                const increaseAmount = Math.round(campaign.spend * 0.3);
                const projectedRevenue = increaseAmount * campaign.roas;

                result.recommendations.push({
                    id: `search_scale_${campaign.id}_${Date.now()}`,
                    priority: 1,
                    category: 'budget',
                    headline: `🔥 Scale "${campaign.name}" - ${campaign.roas.toFixed(1)}x ROAS`,
                    explanation: `This search campaign is delivering exceptional results with a ${campaign.roas.toFixed(1)}x ROAS. ` +
                        `Increasing the budget by 30% is projected to generate an additional $${projectedRevenue.toFixed(0)} ` +
                        `in revenue over the next 30 days based on current performance.`,
                    dataPoints: [
                        `Current ROAS: ${campaign.roas.toFixed(2)}x`,
                        `30-day spend: $${campaign.spend.toFixed(0)}`,
                        `30-day revenue: $${campaign.revenue.toFixed(0)}`,
                        `Conversions: ${campaign.conversions}`,
                        `CPC: $${campaign.cpc.toFixed(2)}`
                    ],
                    action: {
                        actionType: 'budget_increase',
                        campaignId: campaign.id,
                        campaignName: campaign.name,
                        platform: 'google',
                        currentBudget: campaign.spend,
                        suggestedBudget: campaign.spend + increaseAmount,
                        changeAmount: increaseAmount,
                        changePercent: 30,
                        reason: 'High ROAS search campaign scaling'
                    } as BudgetAction,
                    confidence: Math.min(90, 60 + Math.floor(campaign.conversions / 2)),
                    estimatedImpact: {
                        revenueChange: projectedRevenue,
                        spendChange: increaseAmount,
                        timeframe: '30d'
                    },
                    platform: 'google',
                    source: 'SearchCampaignAdvisor',
                    tags: ['search', 'scaling', 'high-roas']
                });

                result.summary.opportunitiesFound++;
            }

            // 2. Pause/reduce underperforming search campaigns
            const underperformers = searchCampaigns
                .filter(c => c.roas < 1 && c.spend >= 100)
                .sort((a, b) => a.roas - b.roas);

            for (const campaign of underperformers.slice(0, 2)) {
                const savingsAmount = Math.round(campaign.spend * 0.5);

                result.recommendations.push({
                    id: `search_pause_${campaign.id}_${Date.now()}`,
                    priority: 1,
                    category: 'budget',
                    headline: `⚠️ Reduce "${campaign.name}" - Only ${campaign.roas.toFixed(2)}x ROAS`,
                    explanation: `This search campaign is underperforming with just ${campaign.roas.toFixed(2)}x ROAS ` +
                        `($${campaign.spend.toFixed(0)} spend, $${campaign.revenue.toFixed(0)} revenue). ` +
                        `Reducing budget by 50% will save $${savingsAmount.toFixed(0)} that can be reallocated to better-performing campaigns.`,
                    dataPoints: [
                        `Current ROAS: ${campaign.roas.toFixed(2)}x (below 1x breakeven)`,
                        `30-day spend: $${campaign.spend.toFixed(0)}`,
                        `30-day revenue: $${campaign.revenue.toFixed(0)}`,
                        `Estimated savings: $${savingsAmount.toFixed(0)}/month`
                    ],
                    action: {
                        actionType: 'budget_decrease',
                        campaignId: campaign.id,
                        campaignName: campaign.name,
                        platform: 'google',
                        currentBudget: campaign.spend,
                        suggestedBudget: campaign.spend - savingsAmount,
                        changeAmount: -savingsAmount,
                        changePercent: -50,
                        reason: 'Underperforming search campaign'
                    } as BudgetAction,
                    confidence: 80,
                    estimatedImpact: {
                        spendChange: -savingsAmount,
                        timeframe: '30d'
                    },
                    platform: 'google',
                    source: 'SearchCampaignAdvisor',
                    tags: ['search', 'efficiency', 'underperforming']
                });

                result.summary.opportunitiesFound++;
            }

            // 3. Suggest new search campaign if no search campaigns but has revenue
            if (searchCampaigns.length === 0) {
                const suggestNewCampaign = await this.suggestNewSearchCampaign(accountId);
                if (suggestNewCampaign) {
                    result.recommendations.push(suggestNewCampaign);
                    result.summary.opportunitiesFound++;
                }
            }

            // 4. Suggest keyword expansion based on high-performing campaigns
            for (const campaign of highPerformers.slice(0, 1)) {
                const keywordExpansion = await this.suggestKeywordExpansion(accountId, campaign);
                if (keywordExpansion) {
                    result.recommendations.push(keywordExpansion);
                    result.summary.opportunitiesFound++;
                }
            }

        } catch (error) {
            Logger.error('SearchCampaignAdvisor failed', { error, accountId });
        }

        return result;
    }

    /**
     * Suggest creating a new search campaign based on store data.
     */
    private static async suggestNewSearchCampaign(accountId: string): Promise<ActionableRecommendation | null> {
        try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // Get recent revenue to estimate potential
            const revenueData = await prisma.wooOrder.aggregate({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES },
                    dateCreated: { gte: thirtyDaysAgo }
                },
                _sum: { total: true },
                _count: { id: true }
            });

            const totalRevenue = Number(revenueData._sum.total) || 0;
            const orderCount = revenueData._count.id || 0;

            if (totalRevenue < 1000 || orderCount < 10) {
                return null; // Not enough data to recommend
            }

            // Get the account to get store URL
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: {
                    wooUrl: true,
                    name: true,
                    domain: true
                }
            });

            const storeUrl = account?.wooUrl || 'https://yourstore.com';
            const storeName = account?.name || 'Your Store';
            const storeDomain = account?.domain || new URL(storeUrl).hostname.replace('www.', '');

            const avgOrderValue = totalRevenue / orderCount;
            const suggestedBudget = Math.round(avgOrderValue * 0.2 * (orderCount / 30));
            const minBudget = 10;
            const dailyBudget = Math.max(minBudget, Math.min(100, suggestedBudget));

            // Get top products with more details
            const recentOrders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES },
                    dateCreated: { gte: thirtyDaysAgo }
                },
                select: { rawData: true }
            });

            const productFrequency: Record<string, {
                id: string;
                name: string;
                total: number;
                sku?: string;
                permalink?: string;
            }> = {};

            for (const order of recentOrders) {
                const data = order.rawData as any;
                if (data.line_items && Array.isArray(data.line_items)) {
                    for (const item of data.line_items) {
                        const pid = String(item.product_id || item.id || 'unknown');
                        if (!productFrequency[pid]) {
                            productFrequency[pid] = {
                                id: pid,
                                name: item.name,
                                total: 0,
                                sku: item.sku || '',
                                permalink: item.permalink || `${storeUrl}/product/${pid}`
                            };
                        }
                        productFrequency[pid].total += Number(item.total || 0);
                    }
                }
            }

            const topProducts = Object.values(productFrequency)
                .sort((a, b) => b.total - a.total)
                .slice(0, 5);

            // Get product categories for sitelinks from order rawData
            const categorySet = new Set<string>();
            for (const order of recentOrders) {
                const data = order.rawData as any;
                if (data.line_items && Array.isArray(data.line_items)) {
                    for (const item of data.line_items) {
                        const cats = item.categories as any[] | undefined;
                        if (cats && Array.isArray(cats)) {
                            cats.slice(0, 2).forEach((c: any) => {
                                if (c.name) categorySet.add(c.name);
                            });
                        }
                    }
                }
            }
            const categories = [...categorySet].slice(0, 4).map(name => ({
                name,
                slug: name.toLowerCase().replace(/\s+/g, '-')
            }));

            const productKeywords = topProducts
                .filter(p => p.name)
                .map(p => p.name!.split(' ').slice(0, 3).join(' '));

            // Try to get real CPC data from Google Keyword Planner
            let suggestedCpc: number;
            let maxCpc: number;
            let cpcSource: 'keyword_planner' | 'estimated' = 'estimated';
            let keywordPlannerData: { keyword: string; avgCpc: number; avgMonthlySearches: number; competitionLevel: string }[] = [];

            // Check if there's a connected Google Ads account
            const adAccount = await prisma.adAccount.findFirst({
                where: {
                    accountId,
                    platform: 'GOOGLE',
                    refreshToken: { not: null }
                }
            });

            const targetRoas = 2.0;
            const estimatedConversionRate = 0.02;

            if (adAccount && productKeywords.length > 0) {
                try {
                    const keywordIdeas = await GoogleAdsService.getKeywordIdeas(
                        adAccount.id,
                        productKeywords.slice(0, 5)
                    );

                    if (keywordIdeas.length > 0) {
                        // Use real CPC data from Keyword Planner
                        const avgCpcFromPlanner = keywordIdeas.reduce((sum, k) => sum + k.avgCpc, 0) / keywordIdeas.length;

                        if (avgCpcFromPlanner > 0) {
                            suggestedCpc = avgCpcFromPlanner;
                            maxCpc = Math.max(...keywordIdeas.map(k => k.highTopOfPageBidMicros / 1_000_000));
                            cpcSource = 'keyword_planner';

                            // Store for display
                            keywordPlannerData = keywordIdeas.slice(0, 5).map(k => ({
                                keyword: k.keyword,
                                avgCpc: k.avgCpc,
                                avgMonthlySearches: k.avgMonthlySearches,
                                competitionLevel: k.competitionLevel
                            }));

                            Logger.info('[SearchCampaignAdvisor] Using Keyword Planner CPC', {
                                suggestedCpc,
                                maxCpc,
                                keywordCount: keywordIdeas.length
                            });
                        }
                    }
                } catch (error) {
                    Logger.warn('[SearchCampaignAdvisor] Keyword Planner lookup failed, using estimate', { error });
                }
            }

            // Fallback to AOV-based estimate if no Keyword Planner data
            if (cpcSource === 'estimated') {
                // Formula: CPC = AOV * conversion_rate / target_ROAS
                suggestedCpc = (avgOrderValue * estimatedConversionRate) / targetRoas;
                maxCpc = suggestedCpc * 2;
            }

            const projectedRevenue = dailyBudget * 30 * targetRoas;

            // Generate AI-powered ad copy (falls back to templates if AI unavailable)
            const adCopy = await AdCopyGenerator.generate(accountId, {
                storeName,
                storeUrl,
                topProducts: topProducts.map(p => ({
                    name: p.name || 'Product',
                    price: p.total / 10 // Rough estimate
                })),
                avgOrderValue,
                categories: categories.map(c => c.name)
            });

            const headlines = adCopy.headlines;
            const descriptions = adCopy.descriptions;

            // Generate sitelinks from categories
            const sitelinks = categories.map(cat => ({
                text: cat.name.slice(0, 25),
                description1: `Shop our ${cat.name} collection`,
                description2: 'Free shipping available',
                finalUrl: `${storeUrl}/product-category/${cat.slug}`
            }));

            // Add a "Best Sellers" sitelink
            sitelinks.unshift({
                text: 'Best Sellers',
                description1: 'Our most popular products',
                description2: 'Loved by customers',
                finalUrl: `${storeUrl}/shop?orderby=popularity`
            });

            return {
                id: `search_new_campaign_${Date.now()}`,
                priority: 2,
                category: 'structure',
                headline: `🚀 Launch Google Search Campaign - Est. +$${projectedRevenue.toLocaleString()}/mo`,
                explanation: `You're generating $${totalRevenue.toLocaleString()} in revenue but not running Google Search ads. ` +
                    `Search campaigns capture high-intent buyers actively looking for your products. ` +
                    `With your average order value of $${avgOrderValue.toFixed(0)}, a well-optimized search campaign ` +
                    `targeting your top-selling products could generate significant incremental revenue.`,
                dataPoints: [
                    `Current monthly revenue: $${totalRevenue.toLocaleString()}`,
                    `Average order value: $${avgOrderValue.toFixed(0)}`,
                    `Suggested daily budget: $${dailyBudget}/day`,
                    `Target products: ${productKeywords.slice(0, 3).join(', ')}`,
                    `Est. ${targetRoas}x ROAS (conservative for search)`
                ],
                action: {
                    actionType: 'add_keyword',
                    keyword: productKeywords[0] || 'your top product',
                    matchType: 'phrase',
                    suggestedCpc: suggestedCpc,
                    estimatedRoas: targetRoas,
                    estimatedClicks: Math.round(dailyBudget * 30 / suggestedCpc)
                } as KeywordAction,
                confidence: 70,
                estimatedImpact: {
                    revenueChange: projectedRevenue,
                    spendChange: dailyBudget * 30,
                    timeframe: '30d'
                },
                platform: 'google',
                source: 'SearchCampaignAdvisor',
                tags: ['search', 'new-campaign', 'high-intent'],
                implementationDetails: {
                    campaignName: `${storeName} - Search - Top Products`,
                    adGroupName: 'Best Sellers',
                    suggestedKeywords: productKeywords.slice(0, 5).map((keyword, idx) => ({
                        keyword,
                        matchType: idx === 0 ? 'exact' as const : 'phrase' as const,
                        suggestedCpc: suggestedCpc,
                        estimatedClicks: Math.round((dailyBudget * 30 / suggestedCpc) / productKeywords.length),
                        source: 'product_data' as const,
                        adGroupSuggestion: 'Best Sellers'
                    })),
                    budgetSpec: {
                        dailyBudget,
                        bidStrategy: 'maximize_conversions',
                        targetRoas: targetRoas,
                        maxCpc: maxCpc
                    },
                    adSpec: {
                        headlines: headlines.slice(0, 15),
                        descriptions: descriptions.slice(0, 4),
                        finalUrl: storeUrl,
                        displayPath: ['Shop', topProducts[0]?.name?.split(' ')[0]?.slice(0, 15) || 'Products'],
                        sitelinks: sitelinks.slice(0, 4)
                    },
                    steps: [
                        'Open Google Ads and click "+ New Campaign"',
                        'Select "Sales" as your campaign objective',
                        'Choose "Search" as the campaign type',
                        `Name your campaign: "${storeName} - Search - Top Products"`,
                        `Set your daily budget to $${dailyBudget}`,
                        `Choose "Maximize Conversions" with ${targetRoas}x target ROAS`,
                        `Create ad group named "Best Sellers"`,
                        `Add keywords: ${productKeywords.slice(0, 3).join(', ')} (use phrase and exact match)`,
                        'Create Responsive Search Ad with the provided headlines and descriptions',
                        `Set Final URL to: ${storeUrl}`,
                        'Add the suggested sitelink extensions',
                        'Review and launch - monitor for 7-14 days before optimization'
                    ],
                    estimatedTimeMinutes: 30,
                    difficulty: 'medium',
                    targetProducts: topProducts.slice(0, 3).map(p => ({
                        id: p.id,
                        name: p.name || 'Product',
                        sku: p.sku || '',
                        permalink: p.permalink
                    })),
                    structureNotes: `Campaign: "${storeName} - Search - Top Products" → Ad Group: "Best Sellers" → Keywords targeting your top-selling products. Start with phrase and exact match, add broad match after 2 weeks of data.`,

                    // Data source transparency
                    copySource: adCopy.source,
                    dataSourceNotes: {
                        cpc: cpcSource === 'keyword_planner'
                            ? `✓ Validated via Google Keyword Planner. Avg CPC: $${suggestedCpc.toFixed(2)}, Max bid: $${maxCpc.toFixed(2)}`
                            : `Estimated from your $${avgOrderValue.toFixed(0)} AOV × 2% conversion ÷ 2x ROAS. Connect Google Ads for real market data.`,
                        keywords: cpcSource === 'keyword_planner'
                            ? `✓ Validated via Keyword Planner with search volume data.`
                            : `Derived from top-selling products. Connect Google Ads to validate search volume.`,
                        copy: adCopy.source === 'ai'
                            ? 'AI-generated based on your store and products. Review and customize before use.'
                            : 'Generated from templates. Configure OpenRouter API key in Settings for AI-powered copy.'
                    }
                }
            };
        } catch (error) {
            Logger.warn('Failed to suggest new search campaign', { error });
            return null;
        }
    }

    /**
     * Suggest keyword expansion for a high-performing campaign.
     */
    private static async suggestKeywordExpansion(
        accountId: string,
        campaign: SearchCampaignData
    ): Promise<ActionableRecommendation | null> {
        try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // Get site search terms that could be keywords
            const searchEvents = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'search',
                    createdAt: { gte: thirtyDaysAgo }
                },
                select: { payload: true },
                take: 100
            });

            if (searchEvents.length < 10) return null;

            // Aggregate search terms
            const termCounts = new Map<string, number>();
            for (const event of searchEvents) {
                const term = (
                    (event.payload as any)?.query ||
                    (event.payload as any)?.search_term ||
                    (event.payload as any)?.q
                )?.toLowerCase().trim();

                if (term && term.length >= 3 && term.length <= 50) {
                    termCounts.set(term, (termCounts.get(term) || 0) + 1);
                }
            }

            // Find top search terms
            const sortedTerms = [...termCounts.entries()]
                .filter(([, count]) => count >= 3)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            if (sortedTerms.length === 0) return null;

            const topTerm = sortedTerms[0][0];
            const totalSearches = sortedTerms.reduce((s, [, c]) => s + c, 0);

            // Estimate potential based on campaign performance
            const estimatedCpc = campaign.cpc || 1;
            const estimatedClicks = totalSearches * 0.02; // 2% capture rate
            const estimatedRevenue = estimatedClicks * (campaign.revenue / campaign.clicks) * 0.5; // 50% of campaign avg

            return {
                id: `search_expand_${campaign.id}_${Date.now()}`,
                priority: 2,
                category: 'optimization',
                headline: `🔍 Add "${topTerm}" to "${campaign.name}" - Based on ${totalSearches} site searches`,
                explanation: `Users are searching for "${topTerm}" on your site ${sortedTerms[0][1]} times in the past 30 days. ` +
                    `Adding this as a keyword to your high-performing search campaign "${campaign.name}" ` +
                    `could capture this high-intent traffic at your current ${campaign.roas.toFixed(1)}x ROAS.`,
                dataPoints: [
                    `Site searches for "${topTerm}": ${sortedTerms[0][1]}`,
                    `Total related searches: ${totalSearches}`,
                    `Campaign current ROAS: ${campaign.roas.toFixed(2)}x`,
                    `Suggested match type: phrase`,
                    `Est. CPC: $${estimatedCpc.toFixed(2)}`
                ],
                action: {
                    actionType: 'add_keyword',
                    keyword: topTerm,
                    matchType: 'phrase',
                    suggestedCpc: estimatedCpc,
                    estimatedRoas: campaign.roas * 0.8, // Slightly conservative
                    estimatedClicks: Math.round(estimatedClicks),
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                    platform: 'google'
                } as KeywordAction,
                confidence: 65,
                estimatedImpact: {
                    revenueChange: estimatedRevenue,
                    timeframe: '30d'
                },
                platform: 'google',
                source: 'SearchCampaignAdvisor',
                tags: ['search', 'keyword-expansion', 'site-search'],
                implementationDetails: {
                    suggestedKeywords: sortedTerms.map(([term, count]) => ({
                        keyword: term,
                        matchType: 'phrase' as const,
                        suggestedCpc: estimatedCpc,
                        estimatedClicks: Math.round(count * 0.02),
                        source: 'site_search' as const,
                        adGroupSuggestion: campaign.name
                    })),
                    steps: [
                        `Open Google Ads and navigate to campaign "${campaign.name}"`,
                        'Go to Keywords section and click "+ Keywords"',
                        `Add "${topTerm}" as a phrase match keyword`,
                        `Set initial CPC bid to $${estimatedCpc.toFixed(2)}`,
                        'Save and monitor for 100+ impressions before adjusting',
                        'Consider adding the other suggested keywords from site search as well'
                    ],
                    estimatedTimeMinutes: 10,
                    difficulty: 'easy',
                    structureNotes: `Add to existing ad group in "${campaign.name}". Start with phrase match to balance reach and relevance.`
                }
            };
        } catch (error) {
            Logger.warn('Failed to suggest keyword expansion', { error });
            return null;
        }
    }
}
