/**
 * Budget Advisor
 * 
 * Generates budget optimization recommendations based on ROAS performance.
 * Extracted from AdOptimizer for modularity.
 */

/**
 * Generate specific budget recommendations based on ROAS performance.
 * @param analysis - Campaign analysis data with top_spenders
 * @param platform - 'Google' or 'Meta'
 * @param suggestions - Array to push suggestions into
 */
export function processBudgetSuggestions(
    analysis: { top_spenders?: { campaign: string; spend: string; roas: string }[]; summary?: { total_spend: string } },
    platform: string,
    suggestions: string[]
): void {
    if (!analysis.top_spenders || analysis.top_spenders.length === 0) return;

    const highRoasCampaigns = analysis.top_spenders.filter((c) => {
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
