import type { AdMetric } from './types';

export interface InsightRange { startDate: string; endDate: string }
function calendarDate(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Invalid date');
    const date = value.slice(0, 10);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || (value.length > 10 && !Number.isFinite(Date.parse(value)))) throw new Error('Invalid date');
    return date;
}
export function insightRange(query: { startDate?: unknown; endDate?: unknown }): InsightRange | undefined {
    if (query.startDate === undefined && query.endDate === undefined) return undefined;
    try {
        const range = { startDate: calendarDate(query.startDate), endDate: calendarDate(query.endDate) };
        if (range.startDate > range.endDate) throw new Error('Reversed dates');
        return range;
    } catch { throw Object.assign(new Error('Provide a valid startDate and endDate in chronological order'), { statusCode: 400 }); }
}
/** Never combine missing providers, unlike currencies, or unlike reporting windows. */
export function summarizeInsights(metrics: Array<AdMetric | null>, expected?: InsightRange) {
    if (!metrics.length) return { hasData: false, spend: null, roas: null, clicks: null, impressions: null, currency: null, period: expected ?? null };
    let spend = 0, clicks = 0, impressions = 0, revenue = 0;
    let currency: string | undefined; let period: InsightRange | undefined;
    for (const metric of metrics) {
        if (!metric || ![metric.spend, metric.clicks, metric.impressions, metric.roas].every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Complete ad metrics unavailable');
        const code = typeof metric.currency === 'string' ? metric.currency.trim().toUpperCase() : '';
        if (!/^[A-Z]{3}$/.test(code) || (currency && currency !== code)) throw new Error('Ad summary requires one known currency');
        const window = { startDate: calendarDate(metric.date_start), endDate: calendarDate(metric.date_stop) };
        if (window.startDate > window.endDate || (period && (period.startDate !== window.startDate || period.endDate !== window.endDate)) || (expected && (expected.startDate !== window.startDate || expected.endDate !== window.endDate))) throw new Error('Ad summary requires matching reporting windows');
        currency = code; period = window;
        spend += metric.spend; clicks += metric.clicks; impressions += metric.impressions; revenue += metric.spend * metric.roas;
        if (![spend, clicks, impressions, revenue].every(Number.isFinite)) throw new Error('Ad summary exceeds numeric range');
    }
    const roas = spend > 0 ? revenue / spend : 0;
    if (!Number.isFinite(roas)) throw new Error('Invalid combined ROAS');
    return { hasData: true, spend, clicks, impressions, roas, currency, period };
}
