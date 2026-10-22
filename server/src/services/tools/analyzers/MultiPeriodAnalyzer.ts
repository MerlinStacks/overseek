import { prisma } from '../../../utils/prisma';
import { AdsService } from '../../ads';
import { boundedRead, calendarWindow, currencyCode, nonnegative, trustedAccount } from '../analysisObservations';

interface Metrics { spend: number; revenue: number; clicks: number; impressions: number; conversions: number; roas: number | null; ctr: number | null; cpc: number | null; cpa: number | null }
type Periods = Record<'7d' | '30d' | '90d', Metrics | null>;
export interface MultiPeriodData { adAccountId: string; platform: string; currency: string | null; periods: Periods; available: boolean; reason?: string }
export interface MultiPeriodAnalysis {
    hasData: boolean; accounts: MultiPeriodData[]; combined: Periods; currency: string | null;
    coverage: { expected: number; observed: number; complete: boolean; timezone?: string; startDate?: string; endDate?: string; note: string };
    trends: { roas_7d_vs_30d: { change: number | null; confidence: null }; roas_30d_vs_90d: { change: number | null; confidence: null }; performance_trajectory: 'improving' | 'stable' | 'declining' | null };
    anomalies: never[]; suggestions: string[]; actionableRecommendations: never[];
}
function sum(rows: { spend: number; conversionsValue: number; clicks: number; impressions: number; conversions: number }[]): Metrics {
    const totals = rows.reduce((s, r) => ({ spend: s.spend + r.spend, revenue: s.revenue + r.conversionsValue, clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions, conversions: s.conversions + r.conversions }), { spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0 });
    if (!Object.values(totals).every(nonnegative)) throw new Error('Metric totals exceeded bounds');
    return { ...totals, roas: totals.spend > 0 ? totals.revenue / totals.spend : null, ctr: totals.impressions > 0 ? totals.clicks / totals.impressions * 100 : null, cpc: totals.clicks > 0 ? totals.spend / totals.clicks : null, cpa: totals.conversions > 0 ? totals.spend / totals.conversions : null };
}
export class MultiPeriodAnalyzer {
    static async analyze(accountId: string): Promise<MultiPeriodAnalysis> {
        trustedAccount(accountId);
        const empty = (): Periods => ({ '7d': null, '30d': null, '90d': null });
        const result: MultiPeriodAnalysis = { hasData: false, accounts: [], combined: empty(), currency: null,
            coverage: { expected: 0, observed: 0, complete: false, note: 'Provider calendar dates evaluated against account-timezone complete days. Currency is configured ad-account currency, not present on daily rows. Cross-account totals are withheld because provider timezone alignment is unverified. Comparisons are descriptive, not significance tests or causal revenue.' },
            trends: { roas_7d_vs_30d: { change: null, confidence: null }, roas_30d_vs_90d: { change: null, confidence: null }, performance_trajectory: null }, anomalies: [], suggestions: [], actionableRecommendations: [] };
        try {
            const window = await calendarWindow(accountId, 90);
            Object.assign(result.coverage, { timezone: window.timezone, startDate: window.startDate, endDate: window.endDate });
            const accounts = await prisma.adAccount.findMany({ where: { accountId }, select: { id: true, platform: true, currency: true }, orderBy: { id: 'asc' }, take: 51 });
            result.coverage.expected = accounts.length;
            if (accounts.length > 50) throw new Error('Account limit exceeded');
            result.accounts = await Promise.all(accounts.map(async account => {
                const entry: MultiPeriodData = { adAccountId: account.id, platform: account.platform, currency: currencyCode(account.currency), periods: empty(), available: false };
                try {
                    if (!entry.currency || !['GOOGLE', 'META'].includes(account.platform)) throw new Error('Unsupported provider/currency');
                    const rows = await boundedRead(account.platform === 'GOOGLE' ? AdsService.getGoogleDailyTrends(account.id, 91) : AdsService.getMetaDailyTrends(account.id, 91));
                    if (!Array.isArray(rows) || rows.length > 100) throw new Error('Invalid daily rows');
                    const dates = new Map<string, typeof rows[number]>();
                    for (const row of rows) {
                        if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date || ![row.spend, row.conversionsValue, row.clicks, row.impressions, row.conversions].every(nonnegative)) throw new Error('Invalid observations');
                        if (dates.has(row.date)) throw new Error('Duplicate date'); dates.set(row.date, row);
                    }
                    for (const days of [7, 30, 90] as const) {
                        const selected = Array.from({ length: days }, (_, i) => dates.get(window.shift(window.today, -days + i)));
                        if (selected.every(row => row !== undefined)) entry.periods[`${days}d`] = sum(selected as typeof rows);
                    }
                    entry.available = Object.values(entry.periods).some(Boolean);
                    if (!entry.periods['90d']) entry.reason = 'Incomplete daily coverage; missing days are not zeros';
                } catch { entry.reason = 'Provider observations unavailable or invalid'; }
                return entry;
            }));
            result.coverage.observed = result.accounts.filter(a => a.available).length;
            result.hasData = result.coverage.observed > 0;
            const currencies = new Set(result.accounts.map(a => a.currency));
            if (accounts.length === 1 && currencies.size === 1 && !currencies.has(null)) {
                result.currency = result.accounts[0].currency;
                for (const key of ['7d', '30d', '90d'] as const) {
                    if (result.accounts.every(a => a.periods[key])) result.combined[key] = sum(result.accounts.map(a => ({ ...a.periods[key]!, conversionsValue: a.periods[key]!.revenue })));
                }
            }
            result.coverage.complete = !!result.combined['90d'];
            const change = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && b > 0 ? (a - b) / b * 100 : null;
            result.trends.roas_7d_vs_30d.change = change(result.combined['7d']?.roas, result.combined['30d']?.roas);
            result.trends.roas_30d_vs_90d.change = change(result.combined['30d']?.roas, result.combined['90d']?.roas);
            if (result.hasData) result.suggestions.push('Review account-level calendar observations and missing-day coverage. Overlapping 7/30/90-day windows are descriptive; they do not justify campaign budget actions.');
        } catch { result.suggestions.push('Multi-period observations unavailable; no trend or budget conclusion was made.'); }
        return result;
    }
    static formatSummary(result: MultiPeriodAnalysis) {
        return result.hasData ? `Observed ${result.coverage.observed}/${result.coverage.expected} accounts. ${result.coverage.complete ? 'Complete 90-day calendar coverage.' : 'Incomplete or incompatible aggregate coverage.'} No statistical significance or budget action inferred.` : 'Ad performance observations unavailable.';
    }
}
