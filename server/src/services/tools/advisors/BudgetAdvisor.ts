import { metricText } from './metricText';
import { currencyCode, text } from '../toolData';

interface BudgetAnalysis {
    top_spenders?: { campaign: string; spend: string; roas: string; currency?: string }[];
    summary?: { total_spend: string; days?: number; period?: string; currency?: string };
    by_currency?: Record<string, BudgetAnalysis>;
    partial_data?: boolean;
}

/** Observations are not proof of budget limitation or a forecast of incremental returns. */
export function processBudgetSuggestions(analysis: BudgetAnalysis, platform: string, suggestions: string[]): void {
    if (!analysis || analysis.partial_data) return;
    if (analysis.summary?.currency === 'MULTIPLE' && analysis.by_currency) {
        for (const [currency, report] of Object.entries(analysis.by_currency)) {
            processBudgetSuggestions(report, `${platform} (${currency})`, suggestions);
        }
        return;
    }
    if (!Array.isArray(analysis.top_spenders) || !analysis.top_spenders.length) return;
    const high = analysis.top_spenders.filter(c => c && text(c.campaign) &&
        (metricText(c.roas, 'x') ?? -1) >= 3 && (metricText(c.spend) ?? 0) > 50);
    const period = text(analysis.summary?.period) || 'the reported period';
    for (const campaign of high.slice(0, 2)) {
        suggestions.push(`💰 **Budget Opportunity - ${platform}**: "${campaign.campaign}" reported ${campaign.roas} ROAS on ${campaign.spend} spend (${period}). ` +
            'Review profitability, stock and actual budget constraints before a controlled budget test. Historical ROAS does not guarantee incremental returns.');
    }
    const total = metricText(analysis.summary?.total_spend);
    const parsedDays = analysis.summary?.period?.match(/^Last (\d+) days$/i)?.[1];
    const days = analysis.summary?.days ?? (parsedDays ? Number(parsedDays) : undefined);
    if (total == null || !Number.isSafeInteger(days) || days! <= 0) return;
    const daily = total / days!;
    if (daily < 10) {
        const currency = currencyCode(analysis.summary?.currency) || 'reported currency';
        suggestions.push(`📉 **Low Spend Observation - ${platform}**: Recorded ${currency} ${daily.toFixed(2)}/day over ${days} days. ` +
            'Low spend alone does not establish that campaigns are budget-limited; check demand, targeting, eligibility and budgets.');
    }
}
