import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { dateKeyInTimezone, normalizeTimezone } from '../../../utils/timezone';
import { AdsService } from '../../ads';
import type { TrendMetrics, TrendsSummary } from '../../ads/types';
import { currencyCode, finiteAmount, record, shiftDate, text } from '../toolData';

const empty = (): TrendMetrics => ({ spend: 0, conversionsValue: 0, clicks: 0, impressions: 0 });
const unavailable = (): TrendsSummary => ({ this_week_roas: 'N/A', last_week_roas: 'N/A', roas_change: 'N/A', ctr_change: 'N/A', available: false });
const ratio = (numerator: number, denominator: number) => denominator > 0 && Number.isFinite(numerator / denominator) ? numerator / denominator : null;
const change = (previous: number | null, current: number | null) => previous != null && previous > 0 && current != null ? (current - previous) / previous * 100 : null;
const percent = (value: number | null) => value == null || !Number.isFinite(value) ? 'N/A' : `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`;

export async function processTrendAnalysis(accountId: string, suggestions: string[], summary: { trends?: TrendsSummary }): Promise<void> {
    if (!text(accountId)) return;
    try {
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
        if (!account) throw new Error('Account not found');
        const today = dateKeyInTimezone(new Date(), normalizeTimezone(account.timezone));
        const first = shiftDate(today, -14);
        const split = shiftDate(today, -7);
        const accounts = await prisma.adAccount.findMany({ where: { accountId, platform: { in: ['GOOGLE', 'META'] } },
            select: { id: true, platform: true, name: true, currency: true } });
        if (!accounts.length) return;
        const groups = new Map<string, { current: TrendMetrics; previous: TrendMetrics }>();
        const missing: string[] = [];
        for (const adAccount of accounts) {
            try {
                const currency = currencyCode(adAccount.currency);
                if (!currency) throw new Error('Missing reporting currency');
                // Extra days cover differing provider inclusivity and store/server date boundaries.
                const rows = adAccount.platform === 'GOOGLE'
                    ? await AdsService.getGoogleDailyTrends(adAccount.id, 16)
                    : await AdsService.getMetaDailyTrends(adAccount.id, 16);
                if (!Array.isArray(rows)) throw new Error('Invalid daily trends');
                const days = new Map<string, TrendMetrics>();
                for (const entry of rows) {
                    const row = record(entry);
                    const date = text(row.date);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < first || date >= today) continue;
                    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || days.has(date)) throw new Error('Invalid or duplicate trend date');
                    const values = ['spend', 'conversionsValue', 'clicks', 'impressions'].map(key => finiteAmount(row[key]));
                    if (values.some(value => value == null)) throw new Error('Invalid trend metric');
                    const [spend, conversionsValue, clicks, impressions] = values as number[];
                    days.set(date, { spend, conversionsValue, clicks, impressions });
                }
                // Never silently treat omitted dates (or an API failure) as genuine zero activity.
                if (days.size !== 14) throw new Error('Incomplete daily trends');
                const group = groups.get(currency) || { current: empty(), previous: empty() };
                for (const [date, metrics] of days) {
                    const target = date >= split ? group.current : group.previous;
                    for (const key of ['spend', 'conversionsValue', 'clicks', 'impressions'] as const) target[key] += metrics[key];
                }
                groups.set(currency, group);
            } catch (error) {
                missing.push(adAccount.id);
                Logger.debug('Trend data unavailable for account', { id: adAccount.id, error });
            }
        }
        const reports: Record<string, TrendsSummary> = {};
        for (const [currency, { current, previous }] of groups) {
            const currentRoas = ratio(current.conversionsValue, current.spend);
            const previousRoas = ratio(previous.conversionsValue, previous.spend);
            const roasChange = change(previousRoas, currentRoas);
            const ctrChange = change(ratio(previous.clicks, previous.impressions), ratio(current.clicks, current.impressions));
            reports[currency] = {
                available: true, partial_data: missing.length > 0, currency,
                this_week_roas: currentRoas == null ? 'N/A' : currentRoas.toFixed(2),
                last_week_roas: previousRoas == null ? 'N/A' : previousRoas.toFixed(2),
                roas_change: percent(roasChange), ctr_change: percent(ctrChange),
                this_week_spend: current.spend, last_week_spend: previous.spend,
            };
            if (missing.length) continue; // Partial account coverage must not drive confident advice.
            if (previous.spend > 0 && current.spend === 0) {
                suggestions.unshift(`📉 **Spend Stopped (${currency})**: Recorded spend fell to zero in the latest completed seven-day window. Check campaign delivery and reporting before drawing a ROAS conclusion.`);
            } else if (roasChange != null && roasChange <= -20) {
                suggestions.unshift(`📉 **Performance Drop (${currency})**: ROAS dropped ${Math.abs(roasChange).toFixed(0)}% (${previousRoas!.toFixed(2)}x → ${currentRoas!.toFixed(2)}x). Review recent changes and attribution lag.`);
            } else if (roasChange != null && roasChange >= 20) {
                suggestions.push(`📈 **Performance Improving (${currency})**: ROAS improved ${roasChange.toFixed(0)}% over the two completed seven-day windows.`);
            }
            if (ctrChange != null && ctrChange <= -15) suggestions.push(`📉 **CTR Declining (${currency})**: Click-through rate dropped ${Math.abs(ctrChange).toFixed(0)}%. Review creatives and targeting.`);
        }
        const currencies = Object.keys(reports);
        summary.trends = {
            ...(currencies.length === 1 ? reports[currencies[0]] : unavailable()),
            ...(currencies.length > 1 ? { currency: 'MULTIPLE' } : {}),
            by_currency: reports, partial_data: missing.length > 0, unavailable_accounts: missing,
            period_start: first, period_end: shiftDate(today, -1),
        };
    } catch (error) {
        summary.trends = { ...unavailable(), partial_data: true };
        Logger.warn('Failed to process trend analysis', { error });
    }
}
