/**
 * Ad Optimization Tools
 * 
 * Extracted from AdsTools for modularity.
 * Provides AI-powered optimization suggestions across platforms.
 */

import { Logger } from '../../utils/logger';
import { GoogleAdsTools } from './GoogleAdsTools';
import { MetaAdsTools } from './MetaAdsTools';

export class AdOptimizer {

    /**
     * Get AI-powered optimization suggestions for all ad campaigns.
     * Analyzes both Google and Meta Ads and provides actionable recommendations.
     */
    static async getAdOptimizationSuggestions(accountId: string) {
        try {
            const googleAnalysis = await GoogleAdsTools.analyzeGoogleAdsCampaigns(accountId, 30);
            const metaAnalysis = await MetaAdsTools.analyzeMetaAdsCampaigns(accountId, 30);

            const hasGoogle = typeof googleAnalysis !== 'string';
            const hasMeta = typeof metaAnalysis !== 'string';

            if (!hasGoogle && !hasMeta) {
                return "No ad accounts connected. Connect your Google or Meta Ads account in Marketing > Ad Accounts.";
            }

            const suggestions: string[] = [];
            let combinedSummary: any = {};

            if (hasGoogle) {
                this.processGoogleSuggestions(googleAnalysis, suggestions, combinedSummary);
            }

            if (hasMeta) {
                this.processMetaSuggestions(metaAnalysis, suggestions, combinedSummary);
            }

            if (hasGoogle && hasMeta) {
                this.addCrossPlatformSuggestion(googleAnalysis, metaAnalysis, suggestions);
            }

            if (suggestions.length === 0) {
                suggestions.push(
                    `✅ **Overall Performance**: Your ad campaigns appear to be performing well. ` +
                    `Continue monitoring and make incremental optimizations as data accumulates.`
                );
            }

            return {
                suggestions,
                summary: combinedSummary,
                action_items: suggestions.length > 1
                    ? suggestions.slice(0, 3).map((s, i) => `${i + 1}. ${s.split(':')[0].replace(/[🔴🟢📊💰🚀📁✅🛒🔍⭐]/g, '').trim()}`)
                    : ['Monitor campaign performance', 'Review conversion tracking', 'Test new ad variations']
            };

        } catch (error) {
            Logger.error('Tool Error (getAdOptimizationSuggestions)', { error });
            return "Failed to generate optimization suggestions.";
        }
    }

    private static processGoogleSuggestions(analysis: any, suggestions: string[], summary: any) {
        if (analysis.underperformers?.length > 0) {
            suggestions.push(
                `🔴 **Google Ads - Underperforming Campaigns**: ${analysis.underperformers.length} campaign(s) have ROAS below 1x. ` +
                `Consider pausing or reducing budget for: ${analysis.underperformers.map((c: any) => c.campaign).join(', ')}.`
            );
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
        if (analysis.underperformers?.length > 0) {
            suggestions.push(
                `🔴 **Meta Ads - Underperforming Campaigns**: ${analysis.underperformers.length} campaign(s) have ROAS below 1x. ` +
                `Consider pausing or reducing budget for: ${analysis.underperformers.map((c: any) => c.campaign).join(', ')}.`
            );
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
