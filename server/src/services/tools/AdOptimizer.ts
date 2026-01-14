/**
 * Ad Optimization Tools
 * 
 * Orchestrates AI-powered optimization suggestions across ad platforms.
 * Delegates to domain-specific advisors for modular analysis.
 */

import { Logger } from '../../utils/logger';
import { GoogleAdsTools } from './GoogleAdsTools';
import { MetaAdsTools } from './MetaAdsTools';
import { getSeasonalContext, isBrandCampaign, getCampaignType, SeasonalContext } from './AdContext';

// Import domain advisors
import {
    processInventorySuggestions,
    processBudgetSuggestions,
    processTrendAnalysis,
    processCreativeFatigue,
    processProductAdMatch
} from './advisors';
import { processSearchSuggestions } from './advisors/SearchAdvisor';

// Import multi-period analyzer (AI Marketing Co-Pilot Phase 1)
// Import cross-channel and LTV analyzers (AI Marketing Co-Pilot Phase 2)
import { MultiPeriodAnalyzer, CrossChannelAnalyzer, LTVAnalyzer } from './analyzers';

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
        // Guard against null/undefined text from malformed suggestions
        if (!text) {
            return { text: '', priority: 3, category: 'info' };
        }

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
            const combinedSummary: Record<string, unknown> = {};

            // Add seasonal context
            const seasonalContext = getSeasonalContext();
            if (seasonalContext) {
                combinedSummary.seasonal = seasonalContext;
                this.processSeasonalContext(seasonalContext, suggestions);
            }

            // Process inventory suggestions first (highest priority)
            const activeAdProductIds = hasGoogle ? googleAnalysis?.shopping_products?.active_ad_product_ids : undefined;
            if (options?.includeInventory !== false) {
                await processInventorySuggestions(accountId, suggestions, combinedSummary, activeAdProductIds);
            }

            // Budget optimization suggestions (delegated to BudgetAdvisor)
            if (hasGoogle) {
                processBudgetSuggestions(googleAnalysis, 'Google', suggestions);
            }
            if (hasMeta) {
                processBudgetSuggestions(metaAnalysis, 'Meta', suggestions);
            }

            // Multi-period analysis (AI Marketing Co-Pilot Phase 1)
            const multiPeriodAnalysis = await MultiPeriodAnalyzer.analyze(accountId);
            if (multiPeriodAnalysis.hasData) {
                combinedSummary.multiPeriod = {
                    periods: multiPeriodAnalysis.combined,
                    trends: multiPeriodAnalysis.trends,
                    anomalyCount: multiPeriodAnalysis.anomalies.length
                };
                // Add multi-period suggestions (these come pre-prioritized)
                for (const suggestion of multiPeriodAnalysis.suggestions) {
                    suggestions.push(suggestion);
                }
            }

            // Cross-channel analysis (AI Marketing Co-Pilot Phase 2)
            const crossChannelAnalysis = await CrossChannelAnalyzer.analyze(accountId);
            if (crossChannelAnalysis.hasData) {
                combinedSummary.crossChannel = {
                    channelPerformance: crossChannelAnalysis.channelPerformance,
                    assistedConversions: crossChannelAnalysis.assistedConversions,
                    budgetRecommendation: crossChannelAnalysis.budgetRecommendation
                };
                for (const suggestion of crossChannelAnalysis.suggestions) {
                    suggestions.push(suggestion);
                }
            }

            // LTV analysis (AI Marketing Co-Pilot Phase 2)
            const ltvAnalysis = await LTVAnalyzer.analyze(accountId);
            if (ltvAnalysis.hasData) {
                combinedSummary.ltv = {
                    overall: ltvAnalysis.overall,
                    channelLtv: ltvAnalysis.channelLtv,
                    highValueSegments: ltvAnalysis.highValueSegments
                };
                for (const suggestion of ltvAnalysis.suggestions) {
                    suggestions.push(suggestion);
                }
            }

            // Legacy trend analysis (kept for week-over-week CTR alerts)
            await processTrendAnalysis(accountId, suggestions, combinedSummary);

            // Product-Ad cross-reference (delegated to ProductAdMatcher)
            if (hasGoogle && googleAnalysis.shopping_products) {
                await processProductAdMatch(accountId, googleAnalysis.shopping_products, suggestions);
            }

            // Creative fatigue detection (delegated to CreativeFatigueAdvisor)
            if (hasMeta) {
                await processCreativeFatigue(accountId, suggestions);
            }

            // Standard campaign suggestions (inline - simple enough to keep here)
            if (hasGoogle) {
                this.processGoogleSuggestions(googleAnalysis, suggestions, combinedSummary, seasonalContext);
                if (googleAnalysis.search_analysis) {
                    processSearchSuggestions(googleAnalysis as any, suggestions);
                }
            }
            if (hasMeta) {
                this.processMetaSuggestions(metaAnalysis, suggestions, combinedSummary, seasonalContext);
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
                    .map((s, i) => `${i + 1}. ${s.text.split(':')[0].replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '').trim()}`)
            };

        } catch (error) {
            Logger.error('Tool Error (getAdOptimizationSuggestions)', { error });
            return { message: "Failed to generate optimization suggestions." };
        }
    }

    // ─────────────────────────────────────────────────────────────
    // SEASONAL CONTEXT
    // ─────────────────────────────────────────────────────────────

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

    private static addUserContextNote(context: string, suggestions: string[], summary: Record<string, unknown>) {
        summary.user_context = context;
        suggestions.push(
            `📝 **Your Notes**: "${context.slice(0, 100)}${context.length > 100 ? '...' : ''}" - ` +
            `Consider this context when reviewing the recommendations above.`
        );
    }

    // ─────────────────────────────────────────────────────────────
    // STANDARD CAMPAIGN ANALYSIS (kept inline - simple logic)
    // ─────────────────────────────────────────────────────────────

    private static processGoogleSuggestions(
        analysis: { underperformers?: { campaign: string }[]; high_performers?: { campaign: string }[]; shopping_products?: { total_products_analyzed?: number; campaigns_with_products?: number; underperforming_products?: { product: string; spend: string; roas: string }[]; high_click_low_conversion?: { product: string; clicks: number }[]; top_products?: { product: string; roas: string }[] }; summary?: unknown },
        suggestions: string[],
        summary: Record<string, unknown>,
        seasonalContext: SeasonalContext | null
    ) {
        if (analysis.underperformers?.length) {
            const nonBrandUnderperformers = analysis.underperformers.filter(c => !isBrandCampaign(c.campaign));
            const brandUnderperformers = analysis.underperformers.filter(c => isBrandCampaign(c.campaign));

            if (nonBrandUnderperformers.length > 0) {
                const note = seasonalContext?.isPeakSeason ? ` (Note: CPMs are elevated during ${seasonalContext.period})` : '';
                suggestions.push(
                    `🔴 **Google Ads - Underperforming Campaigns**: ${nonBrandUnderperformers.length} campaign(s) have ROAS below 1x${note}. ` +
                    `Consider pausing or reducing budget for: ${nonBrandUnderperformers.map(c => c.campaign).join(', ')}.`
                );
            }

            if (brandUnderperformers.length > 0) {
                suggestions.push(
                    `ℹ️ **Google Ads - Brand Campaigns**: ${brandUnderperformers.length} brand campaign(s) have low ROAS - ` +
                    `this is expected as brand campaigns prioritize visibility over direct returns.`
                );
            }
        }

        if (analysis.high_performers?.length) {
            suggestions.push(
                `🟢 **Google Ads - High Performers**: ${analysis.high_performers.length} campaign(s) have ROAS above 3x. ` +
                `Consider increasing budget for: ${analysis.high_performers.map(c => c.campaign).join(', ')}.`
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

    private static processShoppingSuggestions(
        shopping: { underperforming_products?: { product: string; spend: string; roas: string }[]; high_click_low_conversion?: { product: string; clicks: number }[]; top_products?: { product: string; roas: string }[] },
        suggestions: string[]
    ) {
        if (shopping.underperforming_products?.length) {
            const topWasters = shopping.underperforming_products.slice(0, 3);
            suggestions.push(
                `🛒 **Shopping - Underperforming Products**: ${shopping.underperforming_products.length} product(s) have very low ROAS. ` +
                `Consider excluding: ${topWasters.map(p => `"${p.product}" (${p.spend}, ${p.roas} ROAS)`).join('; ')}.`
            );
        }

        if (shopping.high_click_low_conversion?.length) {
            const problematic = shopping.high_click_low_conversion.slice(0, 3);
            suggestions.push(
                `🔍 **Shopping - Landing Page Issues**: ${shopping.high_click_low_conversion.length} product(s) get clicks but no sales. ` +
                `Review pricing/stock for: ${problematic.map(p => `"${p.product}" (${p.clicks} clicks, 0 conversions)`).join('; ')}.`
            );
        }

        if (shopping.top_products?.length) {
            const topPerformers = shopping.top_products.slice(0, 3);
            suggestions.push(
                `⭐ **Shopping - Top Performers**: Your best products are: ${topPerformers.map(p => `"${p.product}" (${p.roas} ROAS)`).join(', ')}. ` +
                `Consider increasing bids on these.`
            );
        }
    }

    private static processMetaSuggestions(
        analysis: { underperformers?: { campaign: string }[]; high_performers?: { campaign: string }[]; summary?: unknown },
        suggestions: string[],
        summary: Record<string, unknown>,
        seasonalContext: SeasonalContext | null
    ) {
        if (analysis.underperformers?.length) {
            const directResponseUnderperformers = analysis.underperformers.filter(
                c => !isBrandCampaign(c.campaign) && getCampaignType(c.campaign) !== 'awareness'
            );
            const brandOrAwarenessCount = analysis.underperformers.length - directResponseUnderperformers.length;

            if (directResponseUnderperformers.length > 0) {
                const note = seasonalContext?.isPeakSeason ? ` (Note: CPMs are elevated during ${seasonalContext.period})` : '';
                suggestions.push(
                    `🔴 **Meta Ads - Underperforming Campaigns**: ${directResponseUnderperformers.length} campaign(s) have ROAS below 1x${note}. ` +
                    `Consider pausing or reducing budget for: ${directResponseUnderperformers.map(c => c.campaign).join(', ')}.`
                );
            }

            if (brandOrAwarenessCount > 0) {
                suggestions.push(
                    `ℹ️ **Meta Ads - Brand/Awareness Campaigns**: ${brandOrAwarenessCount} campaign(s) have low ROAS - ` +
                    `this is expected for brand awareness campaigns which prioritize reach over conversions.`
                );
            }
        }

        if (analysis.high_performers?.length) {
            suggestions.push(
                `🟢 **Meta Ads - High Performers**: ${analysis.high_performers.length} campaign(s) have ROAS above 3x. ` +
                `Consider increasing budget for: ${analysis.high_performers.map(c => c.campaign).join(', ')}.`
            );
        }

        summary.meta = analysis.summary;
    }

    private static addCrossPlatformSuggestion(
        googleAnalysis: { summary: { overall_roas: string } },
        metaAnalysis: { summary: { overall_roas: string } },
        suggestions: string[]
    ) {
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
