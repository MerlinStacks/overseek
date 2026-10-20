/**
 * Search Campaign Advisor
 * 
 * Domain advisor for Google Ads Search campaigns.
 * Analyzes keyword performance to suggest negative keywords, bid adjustments, and ad copy improvements.
 */

import { metricText } from './metricText';
import { text } from '../toolData';

export const processSearchSuggestions = (
    analysis: {
        search_analysis?: {
            negative_opportunities?: { keyword: string; spend: string; clicks: number }[];
            top_keywords?: { keyword: string; roas: string }[];
            low_ctr_keywords?: { keyword: string; ctr: string; impressions: number }[];
        }
    },
    suggestions: string[]
) => {
    const search = analysis?.search_analysis;
    if (!search) return;

    // 1. Negative Keyword Opportunities (High Spend, Zero Conversions)
    const negative = Array.isArray(search.negative_opportunities) ? search.negative_opportunities.filter(k => k && text(k.keyword) &&
        metricText(k.spend) != null && Number.isFinite(k.clicks) && k.clicks >= 0) : [];
    if (negative.length > 0) {
        const topWasters = negative.slice(0, 3);
        const keywordsList = topWasters.map(k => `"${k.keyword}" (${k.spend}, ${k.clicks} clicks)`).join('; ');

        suggestions.push(
            `🚫 **Search - Negative Keyword Opportunity**: ${negative.length} keyword(s) were reported with spend and zero conversions. ` +
            `Consider adding as negative keywords: ${keywordsList}.`
        );
    }

    // 2. High Performing Keywords (Bid Scaling)
    if (Array.isArray(search.top_keywords)) {
        const bestKeywords = search.top_keywords.filter(k => k && text(k.keyword) && (metricText(k.roas, 'x') ?? -1) > 4).slice(0, 3);

        if (bestKeywords.length > 0) {
            suggestions.push(
                `⭐ **Search - Top Keywords**: These keywords have exceptional ROAS (> 4x): ${bestKeywords.map(k => `"${k.keyword}" (${k.roas})`).join(', ')}. ` +
                `Consider increasing bids to capture more volume.`
            );
        }
    }

    // 3. Low CTR Warnings (Ad Copy Relevance)
    const lowCtr = Array.isArray(search.low_ctr_keywords) ? search.low_ctr_keywords.filter(k => k && text(k.keyword) &&
        metricText(k.ctr, '%') != null && metricText(k.ctr, '%')! < 1 && Number.isFinite(k.impressions) && k.impressions > 1000) : [];
    if (lowCtr.length > 0) {
        const worstCtr = lowCtr.slice(0, 3);

        suggestions.push(
            `🔍 **Search - Low CTR Alert**: ${lowCtr.length} high-impression keyword(s) have very low CTR (< 1%). ` +
            `Review ad copy for relevance: ${worstCtr.map(k => `"${k.keyword}" (${k.ctr} CTR)`).join(', ')}.`
        );
    }
};
