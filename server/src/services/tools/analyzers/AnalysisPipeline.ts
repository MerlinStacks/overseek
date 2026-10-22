import crypto from 'node:crypto';
import { MultiPeriodAnalyzer } from './MultiPeriodAnalyzer';
import { CrossChannelAnalyzer } from './CrossChannelAnalyzer';
import { LTVAnalyzer } from './LTVAnalyzer';
import { FunnelAnalyzer } from './FunnelAnalyzer';
import { AudienceAnalyzer } from './AudienceAnalyzer';
import { ProductOpportunityAnalyzer } from './ProductOpportunityAnalyzer';
import { KeywordOpportunityAnalyzer } from './KeywordOpportunityAnalyzer';
import { NegativeKeywordAnalyzer } from './NegativeKeywordAnalyzer';
import { CannibalizationAnalyzer } from './CannibalizationAnalyzer';
import { MarketingStrategyAdvisor } from '../advisors/MarketingStrategyAdvisor';
import { SearchCampaignAdvisor } from '../advisors/SearchCampaignAdvisor';
import { getFeedbackContext, shouldFilterRecommendation } from '../feedback/FeedbackService';
import { boundedRead, record, trustedAccount } from '../analysisObservations';

interface Advisory { id: string; feedbackId?: string; text: string; source: string; priority: 1 | 2 | 3; category: string; confidence: null; actionability: 'review-only'; provenance: 'legacy-unverified' | 'observed-advisory' }
interface SourceResult { status: 'fulfilled' | 'unavailable'; hasData: boolean; suggestions: Advisory[]; coverage: unknown; durationMs: number }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 10000;
function safeMetadata(value: unknown, depth = 0): boolean {
    if (depth > 6) return false;
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 10000) return true;
    if (Array.isArray(value)) return value.length <= 100 && value.every(item => safeMetadata(item, depth + 1));
    return !!value && typeof value === 'object' && Object.entries(value).length <= 100 && Object.entries(value).every(([key, entry]) => !['__proto__', 'prototype', 'constructor'].includes(key) && safeMetadata(entry, depth + 1));
}
const fields = ['suggestions', 'recommendations', 'unpromotedProducts', 'underperformingProducts', 'highPotentialProducts', 'keywordOpportunities', 'negativeKeywordOpportunities', 'bidAdjustments', 'cannibalized', 'paidOpportunities', 'actionableRecommendations'];
export class AnalysisPipeline {
    static async runAll(accountId: string, userContext?: string) {
        trustedAccount(accountId);
        if (userContext !== undefined && (typeof userContext !== 'string' || userContext.length > 8000)) throw new Error('Invalid business context');
        const started = Date.now();
        // Sharing a promise avoids an extra set of provider calls for strategic observations.
        const multi = Promise.resolve().then(() => MultiPeriodAnalyzer.analyze(accountId));
        const sources: Record<string, () => Promise<unknown>> = {
            multiPeriod: () => multi, crossChannel: () => CrossChannelAnalyzer.analyze(accountId), ltv: () => LTVAnalyzer.analyze(accountId), funnel: () => FunnelAnalyzer.analyze(accountId),
            audience: () => AudienceAnalyzer.analyze(accountId), productOpp: () => ProductOpportunityAnalyzer.analyze(accountId), keywordOpp: () => KeywordOpportunityAnalyzer.analyze(accountId),
            negativeKw: () => NegativeKeywordAnalyzer.analyze(accountId), cannibalization: () => CannibalizationAnalyzer.analyze(accountId),
            strategy: async () => MarketingStrategyAdvisor.analyze(accountId, await multi), searchCampaigns: () => SearchCampaignAdvisor.analyze(accountId),
        };
        const results: Record<string, SourceResult> = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([source, run]): Promise<[string, SourceResult]> => {
            const start = Date.now();
            try {
                const value = record(await boundedRead(Promise.resolve().then(run), 30000));
                if (typeof value.hasData !== 'boolean') throw new Error('Invalid source result');
                if (record(value.metadata).accountId !== undefined && record(value.metadata).accountId !== accountId) throw new Error('Wrong account result');
                if (value.coverage !== undefined && (!safeMetadata(value.coverage) || JSON.stringify(value.coverage).length > 20000)) throw new Error('Invalid coverage metadata');
                const entries: Advisory[] = [];
                for (const field of fields) {
                    if (value[field] === undefined) continue;
                    const rows = value[field]; if (!Array.isArray(rows) || rows.length > 500) throw new Error('Invalid source list');
                    for (const row of rows) {
                        const data = record(row), body = typeof row === 'string' ? row : data.text ?? data.headline;
                        if (!text(body)) throw new Error('Invalid advice');
                        const category = typeof data.category === 'string' && data.category.length <= 80 ? data.category : 'optimization';
                        const resource = record(data.action);
                        const identity = JSON.stringify([accountId, source, data.platform, resource.adAccountId, resource.campaignId, resource.productId, resource.keyword, body]);
                        entries.push({ id: crypto.createHash('sha256').update(identity).digest('hex'), ...(text(data.id) ? { feedbackId: data.id } : {}), text: body, source, priority: typeof data.priority === 'number' && [1, 2, 3].includes(data.priority) ? data.priority as 1 | 2 | 3 : 3,
                            category, confidence: null, actionability: 'review-only', provenance: ['multiPeriod', 'productOpp', 'keywordOpp', 'strategy', 'searchCampaigns'].includes(source) ? 'observed-advisory' : 'legacy-unverified' });
                    }
                }
                return [source, { status: 'fulfilled' as const, hasData: value.hasData, suggestions: entries, coverage: value.coverage ?? null, durationMs: Date.now() - start }];
            } catch { return [source, { status: 'unavailable' as const, hasData: false, suggestions: [] as Advisory[], coverage: null, durationMs: Date.now() - start }]; }
        })));
        const feedback = await boundedRead(getFeedbackContext(accountId), 5000).catch(() => null);
        const feedbackAvailable = feedback !== null && feedback.available !== false;
        const all: Advisory[] = Object.values(results).flatMap(result => result.suggestions);
        const unique = new Map<string, Advisory>();
        // No free-text context is translated into an executable policy or priority boost.
        // If feedback cannot be checked, fail closed instead of resurfacing dismissed advice.
        const exclusions = [...(userContext || '').matchAll(/(?:avoid|exclude|do not promote)\s+["“]([^"”]{1,200})["”]/gi)].map(match => match[1].normalize('NFKC').toLowerCase());
        for (const advisory of all) {
            if (exclusions.some(term => advisory.text.normalize('NFKC').toLowerCase().includes(term))) continue;
            if (feedbackAvailable && !shouldFilterRecommendation({ id: advisory.feedbackId || advisory.id, headline: advisory.text, category: advisory.category }, feedback) && !feedback.dismissedIds.has(advisory.id)) unique.set(advisory.id, advisory);
        }
        const suggestions = [...unique.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).slice(0, 200);
        const visible = new Set(suggestions.map(advisory => advisory.id));
        for (const result of Object.values(results)) result.suggestions = result.suggestions.filter(advisory => visible.has(advisory.id));
        return { hasData: Object.values(results).some(result => result.hasData), suggestions, actionableRecommendations: [], results,
            availability: { feedback: feedbackAvailable, complete: Object.values(results).every(result => result.status === 'fulfilled' && result.hasData) },
            context: { supplied: !!userContext, automaticallyApplied: false, quotedExclusionsApplied: exclusions.length, note: 'Quoted avoid/exclude/do not promote phrases filter displayed advice. Other business notes require manual review; free text is not an execution policy. No action is authorized by this pipeline.' },
            summary: { totalSuggestions: suggestions.length, urgentCount: suggestions.filter(s => s.priority === 1).length, importantCount: suggestions.filter(s => s.priority === 2).length, infoCount: suggestions.filter(s => s.priority === 3).length,
                topConfidence: null, analyzersRun: Object.keys(results).length, analyzersAvailable: Object.values(results).filter(result => result.status === 'fulfilled').length, totalDurationMs: Date.now() - started },
            metadata: { analyzedAt: new Date(), durationMs: Date.now() - started, source: 'AnalysisPipeline', accountId, actionValidation: 'not-performed; all advice is review-only' } };
    }
}
