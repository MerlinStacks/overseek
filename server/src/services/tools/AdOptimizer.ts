/**
 * Ad Optimization Tools
 * 
 * Extracted from AdsTools for modularity.
 * Provides AI-powered optimization suggestions across platforms.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { GoogleAdsTools } from './GoogleAdsTools';
import { MetaAdsTools } from './MetaAdsTools';
import { AdsService } from '../ads';
import { isBrandCampaign, getSeasonalContext, getCampaignType, getExpectedRoasThreshold, SeasonalContext } from './AdContext';

export interface AdOptimizerOptions {
    userContext?: string;
    includeInventory?: boolean;
}

/**
 * Prioritized suggestion with urgency level.
 * Priority: 1=urgent, 2=important, 3=info
 */
export interface PrioritizedSuggestion {
    text: string;
    priority: 1 | 2 | 3;
    category: 'stock' | 'performance' | 'budget' | 'creative' | 'seasonal' | 'info';
}

export class AdOptimizer {

    /**
     * Infer priority from suggestion text based on emoji and keywords.
     */
    private static inferPriority(text: string): PrioritizedSuggestion {
        // Urgent (priority 1): Stock alerts, performance drops, seasonal peaks
        if (text.includes('🚫') || text.includes('Stock Alert') ||
            text.includes('📉') || text.includes('Performance Drop') ||
            (text.includes('📅') && text.includes('Peak'))) {
            return {
                text,
                priority: 1,
                category: text.includes('Stock') ? 'stock' : text.includes('📅') ? 'seasonal' : 'performance'
            };
        }

        // Important (priority 2): Underperformers, budget opportunities, warnings
        if (text.includes('🔴') || text.includes('Underperforming') ||
            text.includes('💰') || text.includes('Budget') ||
            text.includes('⚠️') || text.includes('Warning') ||
            text.includes('🛒') || text.includes('🎨')) {
            return {
                text,
                priority: 2,
                category: text.includes('Budget') ? 'budget' : text.includes('🎨') ? 'creative' : 'performance'
            };
        }

        // Info (priority 3): Everything else
        return {
            text,
            priority: 3,
            category: text.includes('ℹ️') || text.includes('Brand') ? 'info' :
                text.includes('🟢') || text.includes('⭐') ? 'performance' : 'info'
        };
    }

    /**
     * Get AI-powered optimization suggestions for all ad campaigns.
     * Analyzes both Google and Meta Ads and provides actionable recommendations.
     * Returns suggestions sorted by priority (urgent first).
     */
    static async getAdOptimizationSuggestions(accountId: string, options?: AdOptimizerOptions) {
        try {
            const googleAnalysis = await GoogleAdsTools.analyzeGoogleAdsCampaigns(accountId, 30);
            const metaAnalysis = await MetaAdsTools.analyzeMetaAdsCampaigns(accountId, 30);

            const hasGoogle = typeof googleAnalysis !== 'string';
            const hasMeta = typeof metaAnalysis !== 'string';

            if (!hasGoogle && !hasMeta) {
                return { message: "No ad accounts connected. Connect your Google or Meta Ads account in Marketing > Ad Accounts." };
            }

            const suggestions: string[] = [];
            let combinedSummary: any = {};

            // Add seasonal context
            const seasonalContext = getSeasonalContext();
            if (seasonalContext) {
                combinedSummary.seasonal = seasonalContext;
                this.processSeasonalContext(seasonalContext, suggestions);
            }

            // Process inventory suggestions first (highest priority)
            const activeAdProductIds = googleAnalysis?.shopping_products?.active_ad_product_ids;

            if (options?.includeInventory !== false) {
                await this.processInventorySuggestions(accountId, suggestions, combinedSummary, activeAdProductIds);
            }

            // Budget optimization suggestions
            if (hasGoogle) {
                this.processBudgetSuggestions(googleAnalysis, 'Google', suggestions);
            }
            if (hasMeta) {
                this.processBudgetSuggestions(metaAnalysis, 'Meta', suggestions);
            }

            // Trend analysis (week-over-week)
            await this.processTrendAnalysis(accountId, suggestions, combinedSummary);

            // Product-Ad cross-reference (shopping campaigns)
            if (hasGoogle && googleAnalysis.shopping_products) {
                await this.processProductAdMatch(accountId, googleAnalysis.shopping_products, suggestions);
            }

            // Creative fatigue detection (Meta only)
            if (hasMeta) {
                await this.processCreativeFatigue(accountId, suggestions);
            }

            // Standard campaign suggestions
            if (hasGoogle) {
                this.processGoogleSuggestions(googleAnalysis, suggestions, combinedSummary);
            }
            if (hasMeta) {
                this.processMetaSuggestions(metaAnalysis, suggestions, combinedSummary);
            }

            if (hasGoogle && hasMeta) {
                this.addCrossPlatformSuggestion(googleAnalysis, metaAnalysis, suggestions);
            }

            // User context note (last)
            if (options?.userContext) {
                this.addUserContextNote(options.userContext, suggestions, combinedSummary);
            }

            if (suggestions.length === 0) {
                suggestions.push(
                    `✅ **Overall Performance**: Your ad campaigns appear to be performing well. ` +
                    `Continue monitoring and make incremental optimizations as data accumulates.`
                );
            }

            // Convert to prioritized format and sort
            const prioritized = suggestions.map(s => this.inferPriority(s));
            prioritized.sort((a, b) => a.priority - b.priority);

            // Legacy format uses sorted order
            const sortedSuggestions = prioritized.map(s => s.text);

            return {
                suggestions: sortedSuggestions,
                prioritized,
                summary: combinedSummary,
                action_items: prioritized
                    .filter(s => s.priority <= 2)
                    .slice(0, 3)
                    .map((s, i) => `${i + 1}. ${s.text.split(':')[0].replace(/[🔴🟢📊💰🚀📁✅🛒🔍⭐🚫⚠️📝📉📈🎨👥💵ℹ️📅]/gu, '').trim()}`)
            };

        } catch (error) {
            Logger.error('Tool Error (getAdOptimizationSuggestions)', { error });
            return { message: "Failed to generate optimization suggestions." };
        }
    }

    // ─────────────────────────────────────────────────────────────
    // FEATURE 1: Budget Optimization Recommendations
    // ─────────────────────────────────────────────────────────────

    /**
     * Generate specific budget recommendations based on ROAS performance.
     */
    private static processBudgetSuggestions(analysis: any, platform: string, suggestions: string[]) {
        if (!analysis.top_spenders || analysis.top_spenders.length === 0) return;

        const highRoasCampaigns = analysis.top_spenders.filter((c: any) => {
            const roas = parseFloat(c.roas?.replace('x', '') || '0');
            const spend = parseFloat(c.spend?.replace(/[$,]/g, '') || '0');
            return roas >= 3 && spend > 50; // ROAS >=3x and meaningful spend
        });

        for (const campaign of highRoasCampaigns.slice(0, 2)) {
            const currentSpend = parseFloat(campaign.spend.replace(/[$,]/g, ''));
            const roas = parseFloat(campaign.roas.replace('x', ''));
            const suggestedIncrease = Math.round(currentSpend * 0.3); // 30% increase
            const projectedRevenue = Math.round(suggestedIncrease * roas);

            suggestions.push(
                `💰 **Budget Opportunity - ${platform}**: "${campaign.campaign}" has ${campaign.roas} ROAS. ` +
                `Increase budget by $${suggestedIncrease}/month to capture ~$${projectedRevenue} additional revenue.`
            );
        }

        // Underspent alerts
        const totalSpend = parseFloat(analysis.summary?.total_spend?.replace(/[$,]/g, '') || '0');
        const daysInPeriod = 30;
        const dailySpend = totalSpend / daysInPeriod;

        // Check for very low daily spend indicating underspend
        if (dailySpend < 10 && analysis.top_spenders.length > 0) {
            suggestions.push(
                `📉 **Underspend Alert - ${platform}**: Only $${dailySpend.toFixed(0)}/day spend. ` +
                `Your campaigns may be limited by budget. Consider increasing daily budgets.`
            );
        }
    }

    // ─────────────────────────────────────────────────────────────
    // FEATURE 2: Trend Analysis & Alerts
    // ─────────────────────────────────────────────────────────────

    /**
     * Analyze week-over-week performance trends.
     */
    private static async processTrendAnalysis(accountId: string, suggestions: string[], summary: any) {
        try {
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId },
                select: { id: true, platform: true, name: true }
            });

            if (adAccounts.length === 0) return;

            let totalThisWeek = { spend: 0, conversionsValue: 0, clicks: 0, impressions: 0 };
            let totalLastWeek = { spend: 0, conversionsValue: 0, clicks: 0, impressions: 0 };

            for (const adAccount of adAccounts) {
                try {
                    let trends: any[] = [];
                    if (adAccount.platform === 'GOOGLE') {
                        trends = await AdsService.getGoogleDailyTrends(adAccount.id, 14);
                    } else if (adAccount.platform === 'META') {
                        trends = await AdsService.getMetaDailyTrends(adAccount.id, 14);
                    }

                    if (trends.length >= 14) {
                        // Split into weeks
                        const thisWeek = trends.slice(-7);
                        const lastWeek = trends.slice(0, 7);

                        for (const day of thisWeek) {
                            totalThisWeek.spend += day.spend || 0;
                            totalThisWeek.conversionsValue += day.conversionsValue || 0;
                            totalThisWeek.clicks += day.clicks || 0;
                            totalThisWeek.impressions += day.impressions || 0;
                        }
                        for (const day of lastWeek) {
                            totalLastWeek.spend += day.spend || 0;
                            totalLastWeek.conversionsValue += day.conversionsValue || 0;
                            totalLastWeek.clicks += day.clicks || 0;
                            totalLastWeek.impressions += day.impressions || 0;
                        }
                    }
                } catch (err) {
                    Logger.debug('Failed to fetch trends for account', { id: adAccount.id });
                }
            }

            // Calculate week-over-week changes
            if (totalLastWeek.spend > 0 && totalThisWeek.spend > 0) {
                const thisWeekRoas = totalThisWeek.spend > 0 ? totalThisWeek.conversionsValue / totalThisWeek.spend : 0;
                const lastWeekRoas = totalLastWeek.spend > 0 ? totalLastWeek.conversionsValue / totalLastWeek.spend : 0;
                const roasChange = lastWeekRoas > 0 ? ((thisWeekRoas - lastWeekRoas) / lastWeekRoas) * 100 : 0;

                const thisWeekCtr = totalThisWeek.impressions > 0 ? (totalThisWeek.clicks / totalThisWeek.impressions) * 100 : 0;
                const lastWeekCtr = totalLastWeek.impressions > 0 ? (totalLastWeek.clicks / totalLastWeek.impressions) * 100 : 0;
                const ctrChange = lastWeekCtr > 0 ? ((thisWeekCtr - lastWeekCtr) / lastWeekCtr) * 100 : 0;

                summary.trends = {
                    this_week_roas: thisWeekRoas.toFixed(2),
                    last_week_roas: lastWeekRoas.toFixed(2),
                    roas_change: `${roasChange >= 0 ? '+' : ''}${roasChange.toFixed(0)}%`,
                    ctr_change: `${ctrChange >= 0 ? '+' : ''}${ctrChange.toFixed(0)}%`
                };

                // Alert on significant drops
                if (roasChange <= -20) {
                    suggestions.unshift(
                        `📉 **Performance Drop**: ROAS dropped ${Math.abs(roasChange).toFixed(0)}% this week ` +
                        `(${lastWeekRoas.toFixed(2)}x → ${thisWeekRoas.toFixed(2)}x). Review recent changes or competitive pressure.`
                    );
                } else if (roasChange >= 20) {
                    suggestions.push(
                        `📈 **Performance Improving**: ROAS improved ${roasChange.toFixed(0)}% this week ` +
                        `(${lastWeekRoas.toFixed(2)}x → ${thisWeekRoas.toFixed(2)}x). Great progress!`
                    );
                }

                if (ctrChange <= -15) {
                    suggestions.push(
                        `📉 **CTR Declining**: Click-through rate dropped ${Math.abs(ctrChange).toFixed(0)}% this week. ` +
                        `Consider refreshing ad creatives or adjusting targeting.`
                    );
                }
            }

        } catch (error) {
            Logger.warn('Failed to process trend analysis', { error });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // FEATURE 3: Product-Ad Cross-Reference
    // ─────────────────────────────────────────────────────────────

    /**
     * Match shopping ad products to WooCommerce inventory for margin analysis.
     */
    private static async processProductAdMatch(accountId: string, shoppingData: any, suggestions: string[]) {
        try {
            if (!shoppingData?.top_products?.length) return;

            // Get WooCommerce products with COGS data
            const wooProducts = await prisma.wooProduct.findMany({
                where: { accountId },
                select: {
                    wooId: true,
                    name: true,
                    sku: true,
                    price: true,
                    cogs: true,
                    rawData: true
                }
            });

            if (wooProducts.length === 0) return;

            // Create lookup maps
            const productsByName = new Map<string, any>();
            const productsBySku = new Map<string, any>();

            for (const p of wooProducts) {
                productsByName.set(p.name.toLowerCase().trim(), p);
                if (p.sku) productsBySku.set(p.sku.toLowerCase().trim(), p);
            }

            // Check top ad products for margin data
            for (const adProduct of shoppingData.top_products.slice(0, 5)) {
                const adTitle = (adProduct.product || '').toLowerCase().trim();
                const adId = adProduct.product_id;

                // Try to match by name or ID
                const matchedProduct = productsByName.get(adTitle) ||
                    productsBySku.get(adId?.toString() || '');

                if (matchedProduct && matchedProduct.cogs && matchedProduct.price) {
                    const price = parseFloat(matchedProduct.price?.toString() || '0');
                    const cogs = parseFloat(matchedProduct.cogs?.toString() || '0');
                    const margin = price > 0 ? ((price - cogs) / price) * 100 : 0;
                    const roas = parseFloat(adProduct.roas?.replace('x', '') || '0');

                    // High ROAS but low margin warning
                    if (roas >= 2 && margin < 15) {
                        suggestions.push(
                            `⚠️ **Low Margin Alert**: "${adProduct.product}" has ${adProduct.roas} ROAS but only ${margin.toFixed(0)}% margin. ` +
                            `Net profit may be minimal. Consider focusing on higher-margin products.`
                        );
                    }
                }
            }

            // Find top sellers NOT in ads (opportunity)
            const lastMonth = new Date();
            lastMonth.setDate(lastMonth.getDate() - 30);

            const topSellingProducts = await prisma.wooProduct.findMany({
                where: { accountId },
                take: 20,
                select: { name: true, rawData: true }
            });

            const adProductNames = new Set(
                (shoppingData.top_products || []).map((p: any) =>
                    (p.product || '').toLowerCase().trim()
                )
            );

            // Find products that might be selling well but not in ads
            const potentialOpportunities = topSellingProducts.filter(p =>
                !adProductNames.has(p.name.toLowerCase().trim())
            ).slice(0, 3);

            if (potentialOpportunities.length > 0) {
                const names = potentialOpportunities.map(p => `"${p.name}"`).join(', ');
                suggestions.push(
                    `🚀 **Ad Opportunity**: Products like ${names} are not in your top Shopping ads. ` +
                    `Consider adding them to your campaigns.`
                );
            }

        } catch (error) {
            Logger.warn('Failed to process product-ad match', { error });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // FEATURE 4: Creative Fatigue Detection (Meta)
    // ─────────────────────────────────────────────────────────────

    /**
     * Detect stale ad creatives in Meta campaigns.
     */
    private static async processCreativeFatigue(accountId: string, suggestions: string[]) {
        try {
            const metaAccounts = await prisma.adAccount.findMany({
                where: { accountId, platform: 'META' },
                select: { id: true, name: true, accessToken: true, externalId: true }
            });

            if (metaAccounts.length === 0) return;

            for (const adAccount of metaAccounts) {
                if (!adAccount.accessToken || !adAccount.externalId) continue;

                try {
                    const actId = adAccount.externalId.startsWith('act_')
                        ? adAccount.externalId
                        : `act_${adAccount.externalId}`;

                    // Fetch ads with creation date and frequency
                    const fields = 'ad_name,created_time,frequency';
                    const url = `https://graph.facebook.com/v18.0/${actId}/ads?fields=${fields}&effective_status=['ACTIVE']&access_token=${adAccount.accessToken}&limit=50`;

                    const response = await fetch(url);
                    const data = await response.json();

                    if (data.error || !data.data) continue;

                    const now = new Date();
                    const staleAds: any[] = [];
                    let highFrequencyCount = 0;

                    for (const ad of data.data) {
                        const createdDate = new Date(ad.created_time);
                        const ageInDays = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
                        const frequency = parseFloat(ad.frequency || '0');

                        if (ageInDays > 45) {
                            staleAds.push({ name: ad.ad_name, age: ageInDays });
                        }
                        if (frequency > 5) {
                            highFrequencyCount++;
                        }
                    }

                    if (staleAds.length > 0) {
                        const oldestAds = staleAds.sort((a, b) => b.age - a.age).slice(0, 2);
                        const names = oldestAds.map(a => `"${a.name}" (${a.age} days)`).join(', ');
                        suggestions.push(
                            `🎨 **Creative Fatigue - Meta**: ${staleAds.length} ad(s) have been running 45+ days: ${names}. ` +
                            `Consider refreshing creatives to maintain performance.`
                        );
                    }

                    if (highFrequencyCount > 0) {
                        suggestions.push(
                            `👥 **Frequency Alert - Meta**: ${highFrequencyCount} ad(s) have frequency >5. ` +
                            `Your audience is seeing ads repeatedly. Consider expanding targeting or pausing high-frequency ads.`
                        );
                    }

                } catch (err) {
                    Logger.debug('Failed to fetch Meta ads for fatigue check', { id: adAccount.id });
                }
            }

        } catch (error) {
            Logger.warn('Failed to process creative fatigue', { error });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // INVENTORY & CONTEXT
    // ─────────────────────────────────────────────────────────────

    /**
     * Process inventory data to generate stock-related suggestions.
     * @param activeAdProductIds Optional list of product IDs currently in ads (skus or IDs)
     */
    private static async processInventorySuggestions(accountId: string, suggestions: string[], summary: any, activeAdProductIds?: string[]) {
        try {
            const outOfStockProducts = await prisma.wooProduct.findMany({
                where: { accountId, stockStatus: 'outofstock' },
                take: 10,
                select: { name: true, sku: true }
            });

            const lowStockProducts = await prisma.wooProduct.findMany({
                where: { accountId, stockStatus: 'instock' },
                take: 100,
                select: { name: true, sku: true, rawData: true }
            });

            const trulyLowStock = lowStockProducts.filter((p: any) => {
                const stockQty = (p.rawData as any)?.stock_quantity;
                return typeof stockQty === 'number' && stockQty > 0 && stockQty < 5;
            }).slice(0, 5);

            const totalProducts = await prisma.wooProduct.count({ where: { accountId } });

            // Filter out of stock alerts to ONLY those being advertised
            // If we have ad data, we shouldn't warn about products not in ads
            let relevantOutOfStock = outOfStockProducts;

            if (activeAdProductIds && activeAdProductIds.length > 0) {
                const activeIdsSet = new Set(activeAdProductIds.map(id => id.toLowerCase().trim()));

                relevantOutOfStock = outOfStockProducts.filter((p: any) => {
                    const sku = (p.sku || '').toLowerCase().trim();
                    const wooId = (p.wooId || '').toString();

                    // Match against SKU or ID (Google Merchant Center usually uses one of these)
                    return activeIdsSet.has(sku) || activeIdsSet.has(wooId);
                });
            }

            const outOfStockCount = relevantOutOfStock.length;

            summary.inventory = {
                total_products: totalProducts,
                out_of_stock_count: outOfStockProducts.length, // Keep real count in summary
                relevant_out_of_stock: outOfStockCount,
                low_stock_count: trulyLowStock.length
            };

            if (outOfStockCount > 0) {
                const productNames = relevantOutOfStock.slice(0, 3).map((p: any) => `"${p.name}"`).join(', ');
                const moreText = outOfStockCount > 3 ? ` and ${outOfStockCount - 3} more` : '';
                suggestions.unshift(
                    `🚫 **Stock Alert**: ${outOfStockCount} advertised product(s) are out of stock: ${productNames}${moreText}. ` +
                    `You are paying for ads on these out-of-stock items. Pause them to save budget.`
                );
            }

            if (trulyLowStock.length > 0) {
                const productNames = trulyLowStock.slice(0, 3).map((p: any) => `"${p.name}"`).join(', ');
                suggestions.push(
                    `⚠️ **Low Stock Warning**: ${trulyLowStock.length} product(s) have low inventory: ${productNames}. ` +
                    `Avoid scaling ads for these until restocked.`
                );
            }

        } catch (error) {
            Logger.warn('Failed to process inventory suggestions', { error });
        }
    }

    private static addUserContextNote(context: string, suggestions: string[], summary: any) {
        summary.user_context = context;
        suggestions.push(
            `📝 **Your Notes**: "${context.slice(0, 100)}${context.length > 100 ? '...' : ''}" - ` +
            `Consider this context when reviewing the recommendations above.`
        );
    }

    /**
     * Add seasonal context and tips to suggestions.
     */
    private static processSeasonalContext(seasonal: SeasonalContext, suggestions: string[]) {
        if (seasonal.isPeakSeason) {
            suggestions.unshift(
                `📅 **${seasonal.period}**: Peak advertising season is active. ` +
                `CPMs may be ~${seasonal.expectedCpmIncrease}% higher than normal. ${seasonal.notes}`
            );
        } else {
            suggestions.push(
                `📅 **Seasonal Note**: ${seasonal.period} period. ${seasonal.notes}`
            );
        }
    }

    // ─────────────────────────────────────────────────────────────
    // STANDARD CAMPAIGN ANALYSIS
    // ─────────────────────────────────────────────────────────────

    private static processGoogleSuggestions(analysis: any, suggestions: string[], summary: any) {
        const seasonalContext = getSeasonalContext();

        if (analysis.underperformers?.length > 0) {
            // Filter out brand campaigns from underperformers
            const nonBrandUnderperformers = analysis.underperformers.filter(
                (c: any) => !isBrandCampaign(c.campaign)
            );
            const brandUnderperformers = analysis.underperformers.filter(
                (c: any) => isBrandCampaign(c.campaign)
            );

            if (nonBrandUnderperformers.length > 0) {
                // Adjust message during peak seasons
                const note = seasonalContext?.isPeakSeason
                    ? ' (Note: CPMs are elevated during ' + seasonalContext.period + ')'
                    : '';
                suggestions.push(
                    `🔴 **Google Ads - Underperforming Campaigns**: ${nonBrandUnderperformers.length} campaign(s) have ROAS below 1x${note}. ` +
                    `Consider pausing or reducing budget for: ${nonBrandUnderperformers.map((c: any) => c.campaign).join(', ')}.`
                );
            }

            if (brandUnderperformers.length > 0) {
                suggestions.push(
                    `ℹ️ **Google Ads - Brand Campaigns**: ${brandUnderperformers.length} brand campaign(s) have low ROAS - ` +
                    `this is expected as brand campaigns prioritize visibility over direct returns.`
                );
            }
        }
        if (analysis.high_performers?.length > 0) {
            suggestions.push(
                `🟢 **Google Ads - High Performers**: ${analysis.high_performers.length} campaign(s) have ROAS above 3x. ` +
                `Consider increasing budget for: ${analysis.high_performers.map((c: any) => c.campaign).join(', ')}.`
            );
        }

        if (analysis.shopping_products) {
            this.processShoppingSuggestions(analysis.shopping_products, suggestions);
        }

        summary.google = analysis.summary;
        if (analysis.shopping_products) {
            summary.shopping_analysis = {
                products_analyzed: analysis.shopping_products.total_products_analyzed,
                campaigns_with_products: analysis.shopping_products.campaigns_with_products
            };
        }
    }

    private static processShoppingSuggestions(shopping: any, suggestions: string[]) {
        if (shopping.underperforming_products?.length > 0) {
            const topWasters = shopping.underperforming_products.slice(0, 3);
            suggestions.push(
                `🛒 **Shopping - Underperforming Products**: ${shopping.underperforming_products.length} product(s) have very low ROAS. ` +
                `Consider excluding: ${topWasters.map((p: any) => `"${p.product}" (${p.spend}, ${p.roas} ROAS)`).join('; ')}.`
            );
        }

        if (shopping.high_click_low_conversion?.length > 0) {
            const problematic = shopping.high_click_low_conversion.slice(0, 3);
            suggestions.push(
                `🔍 **Shopping - Landing Page Issues**: ${shopping.high_click_low_conversion.length} product(s) get clicks but no sales. ` +
                `Review pricing/stock for: ${problematic.map((p: any) => `"${p.product}" (${p.clicks} clicks, 0 conversions)`).join('; ')}.`
            );
        }

        if (shopping.top_products?.length > 0) {
            const topPerformers = shopping.top_products.slice(0, 3);
            suggestions.push(
                `⭐ **Shopping - Top Performers**: Your best products are: ${topPerformers.map((p: any) => `"${p.product}" (${p.roas} ROAS)`).join(', ')}. ` +
                `Consider increasing bids on these.`
            );
        }
    }

    private static processMetaSuggestions(analysis: any, suggestions: string[], summary: any) {
        const seasonalContext = getSeasonalContext();

        if (analysis.underperformers?.length > 0) {
            // Filter out brand/awareness campaigns from underperformers
            const directResponseUnderperformers = analysis.underperformers.filter(
                (c: any) => !isBrandCampaign(c.campaign) && getCampaignType(c.campaign) !== 'awareness'
            );
            const brandOrAwarenessCount = analysis.underperformers.length - directResponseUnderperformers.length;

            if (directResponseUnderperformers.length > 0) {
                const note = seasonalContext?.isPeakSeason
                    ? ' (Note: CPMs are elevated during ' + seasonalContext.period + ')'
                    : '';
                suggestions.push(
                    `🔴 **Meta Ads - Underperforming Campaigns**: ${directResponseUnderperformers.length} campaign(s) have ROAS below 1x${note}. ` +
                    `Consider pausing or reducing budget for: ${directResponseUnderperformers.map((c: any) => c.campaign).join(', ')}.`
                );
            }

            if (brandOrAwarenessCount > 0) {
                suggestions.push(
                    `ℹ️ **Meta Ads - Brand/Awareness Campaigns**: ${brandOrAwarenessCount} campaign(s) have low ROAS - ` +
                    `this is expected for brand awareness campaigns which prioritize reach over conversions.`
                );
            }
        }
        if (analysis.high_performers?.length > 0) {
            suggestions.push(
                `🟢 **Meta Ads - High Performers**: ${analysis.high_performers.length} campaign(s) have ROAS above 3x. ` +
                `Consider increasing budget for: ${analysis.high_performers.map((c: any) => c.campaign).join(', ')}.`
            );
        }
        summary.meta = analysis.summary;
    }

    private static addCrossPlatformSuggestion(googleAnalysis: any, metaAnalysis: any, suggestions: string[]) {
        const googleRoas = parseFloat(googleAnalysis.summary.overall_roas) || 0;
        const metaRoas = parseFloat(metaAnalysis.summary.overall_roas) || 0;

        if (googleRoas > metaRoas * 1.5) {
            suggestions.push(
                `📊 **Platform Comparison**: Google Ads (${googleAnalysis.summary.overall_roas}) is significantly outperforming Meta Ads (${metaAnalysis.summary.overall_roas}). ` +
                `Consider shifting more budget to Google.`
            );
        } else if (metaRoas > googleRoas * 1.5) {
            suggestions.push(
                `📊 **Platform Comparison**: Meta Ads (${metaAnalysis.summary.overall_roas}) is significantly outperforming Google Ads (${googleAnalysis.summary.overall_roas}). ` +
                `Consider shifting more budget to Meta.`
            );
        }
    }
}

