/**
 * AI Tools for Advertising Platform Analytics
 * 
 * Core service for ad account insights.
 * Campaign analysis and optimization are delegated to specialized modules.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdsService } from '../ads';
import { GoogleAdsTools } from './GoogleAdsTools';
import { MetaAdsTools } from './MetaAdsTools';
import { AdOptimizer, AdOptimizerOptions } from './AdOptimizer';

export class AdsTools {

    /**
     * Get ad performance metrics for the account.
     * Aggregates data from all connected ad accounts or a specific platform.
     */
    static async getAdPerformance(accountId: string, platform?: string) {
        try {
            const whereClause: any = { accountId };
            if (platform) {
                whereClause.platform = platform.toUpperCase();
            }

            const adAccounts = await prisma.adAccount.findMany({
                where: whereClause,
                select: { id: true, platform: true, name: true, externalId: true }
            });

            if (adAccounts.length === 0) {
                return "No ad accounts connected. Connect your Meta or Google Ads account in Settings > Integrations.";
            }

            const results: any[] = [];

            for (const adAccount of adAccounts) {
                try {
                    let insights = null;

                    if (adAccount.platform === 'META') {
                        insights = await AdsService.getMetaInsights(adAccount.id);
                    } else if (adAccount.platform === 'GOOGLE') {
                        insights = await AdsService.getGoogleInsights(adAccount.id);
                    }

                    if (insights) {
                        results.push({
                            platform: adAccount.platform,
                            account_name: adAccount.name || `${adAccount.platform} Account`,
                            spend: `${insights.currency} ${insights.spend.toFixed(2)}`,
                            impressions: insights.impressions.toLocaleString(),
                            clicks: insights.clicks.toLocaleString(),
                            ctr: insights.impressions > 0
                                ? `${((insights.clicks / insights.impressions) * 100).toFixed(2)}%`
                                : '0%',
                            roas: `${insights.roas.toFixed(2)}x`,
                            period: `${insights.date_start} to ${insights.date_stop}`
                        });
                    }
                } catch (err) {
                    Logger.warn(`Failed to fetch insights for ad account ${adAccount.id}`, { error: err });
                    results.push({
                        platform: adAccount.platform,
                        account_name: adAccount.name || `${adAccount.platform} Account`,
                        error: "Unable to fetch data - check credentials"
                    });
                }
            }

            if (results.length === 0) {
                return "Could not retrieve ad performance data. Please check your ad account connections.";
            }

            return results;

        } catch (error) {
            Logger.error('Tool Error (getAdPerformance)', { error });
            return "Failed to retrieve ad performance data.";
        }
    }

    /**
     * Compare performance across Meta and Google Ads platforms.
     */
    static async compareAdPlatforms(accountId: string) {
        try {
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId },
                select: { id: true, platform: true, name: true }
            });

            if (adAccounts.length === 0) {
                return "No ad accounts connected. Connect your Meta or Google Ads account in Settings > Integrations.";
            }

            const comparison: any = { meta: null, google: null, recommendation: null };

            comparison.meta = await this.aggregatePlatformMetrics(
                adAccounts.filter(a => a.platform === 'META'),
                'META'
            );

            comparison.google = await this.aggregatePlatformMetrics(
                adAccounts.filter(a => a.platform === 'GOOGLE'),
                'GOOGLE'
            );

            if (comparison.meta && comparison.google) {
                const metaRoas = parseFloat(comparison.meta.avg_roas);
                const googleRoas = parseFloat(comparison.google.avg_roas);

                if (metaRoas > googleRoas) {
                    comparison.recommendation = `Meta Ads is performing better with ${comparison.meta.avg_roas} ROAS vs Google's ${comparison.google.avg_roas}`;
                } else if (googleRoas > metaRoas) {
                    comparison.recommendation = `Google Ads is performing better with ${comparison.google.avg_roas} ROAS vs Meta's ${comparison.meta.avg_roas}`;
                } else {
                    comparison.recommendation = "Both platforms are performing similarly.";
                }
            } else if (!comparison.meta && !comparison.google) {
                return "Could not retrieve data from any ad platform. Please check your connections.";
            }

            return comparison;

        } catch (error) {
            Logger.error('Tool Error (compareAdPlatforms)', { error });
            return "Failed to compare ad platforms.";
        }
    }

    private static async aggregatePlatformMetrics(accounts: any[], platform: string) {
        if (accounts.length === 0) return null;

        let totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalRoas = 0;
        let successCount = 0;

        for (const acc of accounts) {
            try {
                const insights = platform === 'META'
                    ? await AdsService.getMetaInsights(acc.id)
                    : await AdsService.getGoogleInsights(acc.id);

                if (insights) {
                    totalSpend += insights.spend;
                    totalClicks += insights.clicks;
                    totalImpressions += insights.impressions;
                    totalRoas += insights.roas;
                    successCount++;
                }
            } catch { /* skip */ }
        }

        if (successCount === 0) return null;

        return {
            platform: platform === 'META' ? 'Meta (Facebook/Instagram)' : 'Google Ads',
            accounts_count: accounts.length,
            total_spend: totalSpend.toFixed(2),
            total_clicks: totalClicks,
            total_impressions: totalImpressions,
            avg_ctr: totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(2)}%` : '0%',
            avg_roas: `${(totalRoas / successCount).toFixed(2)}x`
        };
    }

    // Delegated methods for backward compatibility

    static async analyzeGoogleAdsCampaigns(accountId: string, days: number = 30) {
        return GoogleAdsTools.analyzeGoogleAdsCampaigns(accountId, days);
    }

    static async analyzeMetaAdsCampaigns(accountId: string, days: number = 30) {
        return MetaAdsTools.analyzeMetaAdsCampaigns(accountId, days);
    }

    static async getAdOptimizationSuggestions(accountId: string, options?: AdOptimizerOptions) {
        // Fetch user's business context for personalized recommendations
        const contextRecord = await prisma.adSuggestionContext.findUnique({
            where: { accountId },
            select: { context: true }
        });
        const userContext = contextRecord?.context || undefined;

        // Run both the legacy optimizer and the new pipeline in parallel
        const [optimizerResult, pipelineResult] = await Promise.all([
            AdOptimizer.getAdOptimizationSuggestions(accountId, options),
            import('./analyzers/AnalysisPipeline').then(m => m.AnalysisPipeline.runAll(accountId, userContext))
        ]);

        // If optimizer returned a string message (no accounts connected), return that
        if (typeof optimizerResult === 'string') {
            return optimizerResult;
        }

        // Merge actionable recommendations from pipeline into the result
        return {
            ...optimizerResult,
            actionableRecommendations: pipelineResult.actionableRecommendations || [],
            userContextApplied: !!userContext
        };
    }

}
