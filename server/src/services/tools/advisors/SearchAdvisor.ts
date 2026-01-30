/**
 * Search Campaign Advisor
 * 
 * Domain advisor for Google Ads Search campaigns.
 * Analyzes keyword performance to suggest negative keywords, bid adjustments, and ad copy improvements.
 */

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
    const search = analysis.search_analysis;
    if (!search) return;

    // 1. Negative Keyword Opportunities (High Spend, Zero Conversions)
    if (search.negative_opportunities && search.negative_opportunities.length > 0) {
        const topWasters = search.negative_opportunities.slice(0, 3);
        const keywordsList = topWasters.map(k => `"${k.keyword}" (${k.spend}, ${k.clicks} clicks)`).join('; ');

        suggestions.push(
            `🚫 **Search - Negative Keyword Opportunity**: ${search.negative_opportunities.length} keyword(s) represent wasted spend with zero conversions. ` +
            `Consider adding as negative keywords: ${keywordsList}.`
        );
    }

    // 2. High Performing Keywords (Bid Scaling)
    if (search.top_keywords && search.top_keywords.length > 0) {
        const bestKeywords = search.top_keywords.filter(k => parseFloat(k.roas) > 4).slice(0, 3);

        if (bestKeywords.length > 0) {
            suggestions.push(
                `⭐ **Search - Top Keywords**: These keywords have exceptional ROAS (> 4x): ${bestKeywords.map(k => `"${k.keyword}" (${k.roas})`).join(', ')}. ` +
                `Consider increasing bids to capture more volume.`
            );
        }
    }

    // 3. Low CTR Warnings (Ad Copy Relevance)
    if (search.low_ctr_keywords && search.low_ctr_keywords.length > 0) {
        const worstCtr = search.low_ctr_keywords.slice(0, 3);

        suggestions.push(
            `🔍 **Search - Low CTR Alert**: ${search.low_ctr_keywords.length} high-impression keyword(s) have very low CTR (< 1%). ` +
            `Review ad copy for relevance: ${worstCtr.map(k => `"${k.keyword}" (${k.ctr} CTR)`).join(', ')}.`
        );
    }
};
