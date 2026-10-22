import { prisma } from '../../utils/prisma';
import { AdsService } from '../ads';
import { summarizeInsights } from '../ads/insightSummary';
import type { AdMetric } from '../ads/types';
import { GoogleAdsTools } from './GoogleAdsTools';
import { MetaAdsTools } from './MetaAdsTools';
import { AdOptimizer, AdOptimizerOptions } from './AdOptimizer';

async function observation(id: string, platform: string): Promise<AdMetric> {
    const metric = platform === 'META' ? await AdsService.getMetaInsights(id) : platform === 'GOOGLE' ? await AdsService.getGoogleInsights(id) : null;
    if (!metric || ![metric.spend, metric.clicks, metric.impressions, metric.roas].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('Invalid observations');
    summarizeInsights([metric]);
    return metric;
}
export class AdsTools {
    static async getAdPerformance(accountId: string, platform?: string) {
        if (platform !== undefined && !['GOOGLE', 'META'].includes(platform.toUpperCase())) throw new Error('Unsupported platform');
        const accounts = await prisma.adAccount.findMany({ where: { accountId, ...(platform ? { platform: platform.toUpperCase() } : {}) }, select: { id: true, platform: true, name: true } });
        return Promise.all(accounts.map(async account => {
            try {
                const metric = await observation(account.id, account.platform);
                return { platform: account.platform, account_name: account.name, currency: metric.currency, spend: metric.spend, impressions: metric.impressions, clicks: metric.clicks,
                    ctr: metric.impressions > 0 ? metric.clicks / metric.impressions * 100 : null, roas: metric.spend > 0 ? metric.roas : null, period: { startDate: metric.date_start, endDate: metric.date_stop }, available: true };
            } catch { return { platform: account.platform, account_name: account.name, available: false, error: 'Observations unavailable' }; }
        }));
    }
    static async compareAdPlatforms(accountId: string) {
        const accounts = await prisma.adAccount.findMany({ where: { accountId }, select: { id: true, platform: true } });
        const [meta, google] = await Promise.all(['META', 'GOOGLE'].map(platform => this.aggregatePlatformMetrics(accounts.filter(account => account.platform === platform), platform)));
        return { meta, google, recommendation: null, note: 'Provider-attributed observations are not causal or deduplicated cross-platform revenue. No automatic budget recommendation.',
            coverage: { connected: accounts.length, unsupported: accounts.filter(account => !['META', 'GOOGLE'].includes(account.platform)).length } };
    }
    private static async aggregatePlatformMetrics(accounts: { id: string }[], platform: string) {
        const results = await Promise.allSettled(accounts.map(account => observation(account.id, platform)));
        const metrics = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        const coverage = { expected: accounts.length, observed: metrics.length, complete: accounts.length > 0 && metrics.length === accounts.length };
        try {
            const summary = summarizeInsights(metrics);
            return { platform, coverage, available: summary.hasData, currency: summary.currency, period: summary.period, total_spend: summary.spend, total_clicks: summary.clicks, total_impressions: summary.impressions,
                avg_roas: summary.spend && summary.spend > 0 ? summary.roas : null, avg_ctr: summary.impressions && summary.impressions > 0 ? summary.clicks! / summary.impressions * 100 : null };
        } catch { return { platform, coverage, available: false, reason: 'Incompatible currency or reporting windows; totals unavailable' }; }
    }
    static async analyzeGoogleAdsCampaigns(accountId: string, days = 30) { return GoogleAdsTools.analyzeGoogleAdsCampaigns(accountId, days); }
    static async analyzeMetaAdsCampaigns(accountId: string, days = 30) { return MetaAdsTools.analyzeMetaAdsCampaigns(accountId, days); }
    static async getAdOptimizationSuggestions(accountId: string, options?: AdOptimizerOptions) {
        let userContext = options?.userContext;
        if (userContext === undefined) userContext = (await prisma.adSuggestionContext.findUnique({ where: { accountId }, select: { context: true } }))?.context || undefined;
        const [optimizer, pipeline] = await Promise.allSettled([
            AdOptimizer.getAdOptimizationSuggestions(accountId, { ...options, userContext }),
            import('./analyzers/AnalysisPipeline').then(m => m.AnalysisPipeline.runAll(accountId, userContext)),
        ]);
        const base = optimizer.status === 'fulfilled' ? optimizer.value : { message: 'Optimizer unavailable' };
        const observations = pipeline.status === 'fulfilled' && Array.isArray(pipeline.value.suggestions) ? pipeline.value.suggestions.map(value => value.provenance === 'legacy-unverified' ? `Unverified legacy advice for manual review: ${value.text}` : value.text) : [];
        return { ...base, suggestions: [...('suggestions' in base ? base.suggestions || [] : []), ...observations].slice(0, 100), action_items: 'action_items' in base ? base.action_items || [] : [], actionableRecommendations: pipeline.status === 'fulfilled' ? pipeline.value.actionableRecommendations || [] : [], userContextApplied: !!userContext,
            analysisSources: pipeline.status === 'fulfilled' ? pipeline.value.results : null,
            availability: { optimizer: optimizer.status === 'fulfilled', pipeline: pipeline.status === 'fulfilled' } };
    }
}
