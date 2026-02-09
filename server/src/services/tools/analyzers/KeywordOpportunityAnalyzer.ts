/**
 * Keyword Opportunity Analyzer
 * 
 * Analyzes site search data and organic traffic to find keyword gaps.
 * Identifies high-converting keywords that aren't being bid on.
 * 
 * Part of AI Marketing Co-Pilot Actionable Suggestions Enhancement.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { REVENUE_STATUSES } from '../../../constants/orderStatus';
import {
    ActionableRecommendation,
    KeywordAction,
    createKeywordHeadline
} from '../types/ActionableTypes';


interface SearchTermData {
    term: string;
    searches: number;
    conversions: number;
    conversionValue: number;
    conversionRate: number;
}

interface KeywordOpportunityResult {
    hasData: boolean;
    keywordOpportunities: ActionableRecommendation[];
    negativeKeywordOpportunities: ActionableRecommendation[];
    bidAdjustments: ActionableRecommendation[];
    summary: {
        totalSearchTermsAnalyzed: number;
        opportunitiesFound: number;
        estimatedMissedRevenue: number;
    };
}


export class KeywordOpportunityAnalyzer {

    /**
     * Analyze keyword opportunities from site search and organic data.
     */
    static async analyze(
        accountId: string,
        activeKeywords?: string[]
    ): Promise<KeywordOpportunityResult> {
        const result: KeywordOpportunityResult = {
            hasData: false,
            keywordOpportunities: [],
            negativeKeywordOpportunities: [],
            bidAdjustments: [],
            summary: {
                totalSearchTermsAnalyzed: 0,
                opportunitiesFound: 0,
                estimatedMissedRevenue: 0
            }
        };

        try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // Get site search events
            const searchEvents = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'search',
                    createdAt: { gte: thirtyDaysAgo }
                },
                select: {
                    payload: true,
                    sessionId: true,
                    createdAt: true
                }
            });

            if (searchEvents.length === 0) {
                return result;
            }

            // Aggregate search terms
            const searchTermCounts = new Map<string, {
                count: number;
                sessionIds: Set<string>;
            }>();

            for (const event of searchEvents) {
                const term = this.normalizeSearchTerm(
                    (event.payload as any)?.query ||
                    (event.payload as any)?.search_term ||
                    (event.payload as any)?.q
                );

                if (!term || term.length < 2) continue;

                const current = searchTermCounts.get(term) || { count: 0, sessionIds: new Set() };
                current.count++;
                current.sessionIds.add(event.sessionId);
                searchTermCounts.set(term, current);
            }

            result.summary.totalSearchTermsAnalyzed = searchTermCounts.size;

            // Get purchase events to calculate conversion rates per search term
            const purchaseSessions = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'purchase',
                    createdAt: { gte: thirtyDaysAgo }
                },
                select: {
                    sessionId: true,
                    payload: true
                }
            });

            const purchaseSessionSet = new Set(purchaseSessions.map(p => p.sessionId));
            const purchaseValues = new Map<string, number>();
            for (const p of purchaseSessions) {
                const value = (p.payload as any)?.value || (p.payload as any)?.revenue || 0;
                purchaseValues.set(p.sessionId, parseFloat(String(value)) || 0);
            }

            // Calculate conversion data for each search term
            const searchTermData: SearchTermData[] = [];

            for (const [term, data] of searchTermCounts.entries()) {
                if (data.count < 3) continue; // Need at least 3 searches for relevance

                const convertedSessions = [...data.sessionIds].filter(s => purchaseSessionSet.has(s));
                const conversions = convertedSessions.length;
                const conversionValue = convertedSessions.reduce((sum, s) => sum + (purchaseValues.get(s) || 0), 0);
                const conversionRate = data.count > 0 ? (conversions / data.count) * 100 : 0;

                searchTermData.push({
                    term,
                    searches: data.count,
                    conversions,
                    conversionValue,
                    conversionRate
                });
            }

            result.hasData = searchTermData.length > 0;

            // Normalize active keywords for comparison
            const activeKeywordSet = new Set(
                (activeKeywords || []).map(k => this.normalizeSearchTerm(k))
            );

            // Find high-converting search terms not being bid on
            const opportunities = searchTermData
                .filter(s => {
                    const isActive = activeKeywordSet.has(s.term) ||
                        [...activeKeywordSet].some(k => s.term.includes(k) || k.includes(s.term));
                    return !isActive && s.conversions >= 2 && s.conversionRate >= 2;
                })
                .sort((a, b) => b.conversionValue - a.conversionValue)
                .slice(0, 10);

            for (const opp of opportunities) {
                const suggestedCpc = this.calculateSuggestedCpc(opp);
                const estimatedRoas = opp.conversionValue / (opp.searches * suggestedCpc);

                const action: KeywordAction = {
                    actionType: 'add_keyword',
                    keyword: opp.term,
                    matchType: opp.term.split(' ').length >= 3 ? 'phrase' : 'exact',
                    suggestedCpc,
                    estimatedRoas: Math.min(10, estimatedRoas),
                    estimatedClicks: opp.searches * 0.02 // Assume 2% click-through from impressions
                };

                result.keywordOpportunities.push({
                    id: `kw_opp_${opp.term.replace(/\s+/g, '_').substring(0, 20)}`,
                    priority: opp.conversions >= 5 ? 1 : 2,
                    category: 'optimization',
                    headline: `🔍 ${createKeywordHeadline(action)} - ${opp.conversions} organic conversions`,
                    explanation: `Users searching for "${opp.term}" on your site converted ${opp.conversions} times ` +
                        `with $${opp.conversionValue.toFixed(0)} in revenue. You're not bidding on this keyword in Google Ads.`,
                    dataPoints: [
                        `${opp.searches} site searches in 30 days`,
                        `${opp.conversions} conversions (${opp.conversionRate.toFixed(1)}% CVR)`,
                        `$${opp.conversionValue.toFixed(0)} conversion value`,
                        `Est. ${estimatedRoas.toFixed(1)}x ROAS at $${suggestedCpc.toFixed(2)} CPC`
                    ],
                    action,
                    confidence: this.calculateConfidence(opp),
                    estimatedImpact: {
                        revenueChange: opp.conversionValue * 0.5, // Conservative 50% of organic
                        roasChange: estimatedRoas,
                        timeframe: '30d'
                    },
                    platform: 'google',
                    source: 'KeywordOpportunityAnalyzer',
                    tags: ['keyword', 'opportunity', 'search']
                });

                result.summary.estimatedMissedRevenue += opp.conversionValue * 0.3;
            }

            result.summary.opportunitiesFound = result.keywordOpportunities.length;

        } catch (error) {
            Logger.error('KeywordOpportunityAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /**
     * Normalize a search term for comparison.
     */
    private static normalizeSearchTerm(term: string | undefined): string {
        if (!term) return '';
        return term
            .toLowerCase()
            .trim()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ');
    }

    /**
     * Calculate suggested CPC based on conversion value and target ROAS.
     */
    private static calculateSuggestedCpc(data: SearchTermData): number {
        if (data.conversions === 0 || data.searches === 0) return 0.50; // Default

        // Average conversion value
        const avgConversionValue = data.conversionValue / data.conversions;

        // Conversion rate as decimal
        const cvr = data.conversions / data.searches;

        // Target 4x ROAS: CPC = (avgValue * CVR) / 4
        let cpc = (avgConversionValue * cvr) / 4;

        // Round to nearest $0.05 and cap between $0.15 and $2.00
        cpc = Math.round(cpc / 0.05) * 0.05;
        return Math.max(0.15, Math.min(2.00, cpc));
    }

    /**
     * Calculate confidence score for a keyword opportunity.
     */
    private static calculateConfidence(data: SearchTermData): number {
        let score = 40; // Base score

        // More searches = more confidence
        if (data.searches >= 20) score += 20;
        else if (data.searches >= 10) score += 10;

        // More conversions = more confidence
        if (data.conversions >= 5) score += 25;
        else if (data.conversions >= 3) score += 15;

        // Higher conversion rate = more confidence
        if (data.conversionRate >= 5) score += 10;

        return Math.min(90, score);
    }
}
