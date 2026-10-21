/**
 * SEO Digest Service
 *
 * Generates a weekly SEO performance digest by aggregating data from:
 * - Search Console (impressions, clicks, position changes)
 * - Tracked keywords (rank movements, new entries/exits)
 * - Competitor analysis (gap changes)
 * - Revenue attribution (keyword-driven revenue)
 *
 * Can be consumed via API preview or sent as a scheduled email.
 */

import { SearchConsoleService } from './SearchConsoleService';

/** SEO Digest sections */
export interface SeoDigest {
    generatedAt: string;
    period: { start: string; end: string };
    coverage: { basis: 'returned-query-sample'; rowLimit: number; currentRows: number; previousRows: number; possiblyTruncated: boolean };
    summary: {
        totalClicks: number;
        totalImpressions: number;
        avgPosition: number | null;
        clicksChange: number;       // vs previous period
        impressionsChange: number;
        positionChange: number | null;     // positive = improved
    };
    topMovers: {
        improved: Array<{ keyword: string; oldPosition: number; newPosition: number; delta: number }>;
        declined: Array<{ keyword: string; oldPosition: number; newPosition: number; delta: number }>;
    };
    topKeywords: Array<{
        keyword: string;
        clicks: number;
        impressions: number;
        position: number;
        estimatedRevenue: number | null;
    }>;
    newKeywords: Array<{ keyword: string; position: number; impressions: number }>;
    alerts: string[];
}

export class SeoDigestService {

    /**
     * Generate a full SEO digest for the account.
     * Covers the last 7 days vs the previous 7 days.
     */
    static async generateDigest(accountId: string): Promise<SeoDigest> {
        if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('Account required');
        const now = new Date();
        const endDate = new Date(now);
        endDate.setUTCDate(endDate.getUTCDate() - 3); // SC data lag
        const startDate = new Date(endDate);
        startDate.setUTCDate(startDate.getUTCDate() - 6);
        const prevEnd = new Date(startDate);
        prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setUTCDate(prevStart.getUTCDate() - 6);

        // Fetch current and previous period data
        const [current, previous] = await Promise.all([
            SearchConsoleService.getSearchAnalytics(accountId, {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                rowLimit: 1000,
            }),
            SearchConsoleService.getSearchAnalytics(accountId, {
                startDate: formatDate(prevStart),
                endDate: formatDate(prevEnd),
                rowLimit: 1000,
            }),
        ]);
        for (const row of [...current, ...previous]) {
            if (typeof row.query !== 'string' || ![row.clicks, row.impressions, row.position].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('SEO digest query data unavailable');
        }

        // Compute aggregate metrics
        const currentTotals = aggregateMetrics(current);
        const previousTotals = aggregateMetrics(previous);

        // Build previous period lookup
        const prevMap = new Map(previous.map(q => [q.query, q]));

        // Find top movers
        const improved: SeoDigest['topMovers']['improved'] = [];
        const declined: SeoDigest['topMovers']['declined'] = [];
        const newKeywords: SeoDigest['newKeywords'] = [];

        for (const q of current) {
            const prev = prevMap.get(q.query);
            if (!prev) {
                if (q.impressions > 5) {
                    newKeywords.push({ keyword: q.query, position: q.position, impressions: q.impressions });
                }
                continue;
            }

            const delta = Math.round((prev.position - q.position) * 10) / 10;
            if (prev.position <= 0 || q.position <= 0) continue;
            if (delta >= 3) {
                improved.push({ keyword: q.query, oldPosition: prev.position, newPosition: q.position, delta });
            } else if (delta <= -3) {
                declined.push({ keyword: q.query, oldPosition: prev.position, newPosition: q.position, delta: Math.abs(delta) });
            }
        }

        improved.sort((a, b) => b.delta - a.delta);
        declined.sort((a, b) => b.delta - a.delta);
        newKeywords.sort((a, b) => b.impressions - a.impressions);

        // Get tracked keywords with revenue for top keywords section
        const topKeywords = [...current].sort((a, b) => b.clicks - a.clicks).slice(0, 10).map(kw => ({
            keyword: kw.query,
            clicks: kw.clicks,
            impressions: kw.impressions,
            position: kw.position,
            estimatedRevenue: null,
        }));

        // Generate alerts
        const alerts: string[] = [];
        if (currentTotals.totalClicks < previousTotals.totalClicks * 0.8) {
            alerts.push(`⚠️ Clicks in the returned query samples dropped by ${Math.round((1 - currentTotals.totalClicks / previousTotals.totalClicks) * 100)}%; samples may differ between periods`);
        }
        if (declined.length > improved.length * 2) {
            alerts.push(`⚠️ More keywords declining (${declined.length}) than improving (${improved.length})`);
        }
        if (newKeywords.length > 5) {
            alerts.push(`${newKeywords.length} queries were observed in this sample but not the previous sample; these are not necessarily new keywords`);
        }
        if (improved.length > 5) {
            alerts.push(`✅ ${improved.length} keywords improved position by 3+ places`);
        }

        return {
            generatedAt: now.toISOString(),
            period: { start: formatDate(startDate), end: formatDate(endDate) },
            coverage: { basis: 'returned-query-sample', rowLimit: 1000, currentRows: current.length, previousRows: previous.length, possiblyTruncated: current.length >= 1000 || previous.length >= 1000 },
            summary: {
                totalClicks: currentTotals.totalClicks,
                totalImpressions: currentTotals.totalImpressions,
                avgPosition: currentTotals.avgPosition,
                clicksChange: currentTotals.totalClicks - previousTotals.totalClicks,
                impressionsChange: currentTotals.totalImpressions - previousTotals.totalImpressions,
                positionChange: previousTotals.avgPosition != null && currentTotals.avgPosition != null ? Math.round((previousTotals.avgPosition - currentTotals.avgPosition) * 10) / 10 : null,
            },
            topMovers: {
                improved: improved.slice(0, 10),
                declined: declined.slice(0, 10),
            },
            topKeywords,
            newKeywords: newKeywords.slice(0, 10),
            alerts,
        };
    }
}

/** Aggregate clicks, impressions, and average position */
function aggregateMetrics(rows: Array<{ clicks: number; impressions: number; position: number }>) {
    if (rows.length === 0) return { totalClicks: 0, totalImpressions: 0, avgPosition: null };

    const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
    const positioned = rows.filter(row => row.position > 0 && row.impressions > 0);
    const weight = positioned.reduce((sum, row) => sum + row.impressions, 0);
    const avgPosition = weight > 0 ? Math.round(positioned.reduce((sum, row) => sum + row.position * row.impressions, 0) / weight * 10) / 10 : null;

    return { totalClicks, totalImpressions, avgPosition };
}

/** Format Date to YYYY-MM-DD */
function formatDate(d: Date): string {
    return d.toISOString().split('T')[0];
}
