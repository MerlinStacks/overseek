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

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SearchConsoleService } from './SearchConsoleService';

/** SEO Digest sections */
export interface SeoDigest {
    generatedAt: string;
    period: { start: string; end: string };
    summary: {
        totalClicks: number;
        totalImpressions: number;
        avgPosition: number;
        clicksChange: number;       // vs previous period
        impressionsChange: number;
        positionChange: number;     // positive = improved
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
        estimatedRevenue: number;
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
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() - 3); // SC data lag
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 7);
        const prevEnd = new Date(startDate);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - 7);

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

        // Compute aggregate metrics
        const currentTotals = aggregateMetrics(current);
        const previousTotals = aggregateMetrics(previous);

        // Build previous period lookup
        const prevMap = new Map(previous.map(q => [q.query, q]));
        const currMap = new Map(current.map(q => [q.query, q]));

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
        const trackedKeywords = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true },
            orderBy: { currentClicks: 'desc' },
            take: 10,
        });

        const topKeywords = trackedKeywords.map(kw => ({
            keyword: kw.keyword,
            clicks: kw.currentClicks ?? 0,
            impressions: kw.currentImpressions ?? 0,
            position: kw.currentPosition ?? 0,
            estimatedRevenue: kw.estimatedRevenue ?? 0,
        }));

        // Generate alerts
        const alerts: string[] = [];
        if (currentTotals.totalClicks < previousTotals.totalClicks * 0.8) {
            alerts.push(`⚠️ Organic clicks dropped by ${Math.round((1 - currentTotals.totalClicks / (previousTotals.totalClicks || 1)) * 100)}% this week`);
        }
        if (declined.length > improved.length * 2) {
            alerts.push(`⚠️ More keywords declining (${declined.length}) than improving (${improved.length})`);
        }
        if (newKeywords.length > 5) {
            alerts.push(`✅ ${newKeywords.length} new keywords appeared in search results`);
        }
        if (improved.length > 5) {
            alerts.push(`✅ ${improved.length} keywords improved position by 3+ places`);
        }

        return {
            generatedAt: now.toISOString(),
            period: { start: formatDate(startDate), end: formatDate(endDate) },
            summary: {
                totalClicks: currentTotals.totalClicks,
                totalImpressions: currentTotals.totalImpressions,
                avgPosition: currentTotals.avgPosition,
                clicksChange: currentTotals.totalClicks - previousTotals.totalClicks,
                impressionsChange: currentTotals.totalImpressions - previousTotals.totalImpressions,
                positionChange: Math.round((previousTotals.avgPosition - currentTotals.avgPosition) * 10) / 10,
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
    if (rows.length === 0) return { totalClicks: 0, totalImpressions: 0, avgPosition: 0 };

    const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
    const avgPosition = Math.round((rows.reduce((s, r) => s + r.position, 0) / rows.length) * 10) / 10;

    return { totalClicks, totalImpressions, avgPosition };
}

/** Format Date to YYYY-MM-DD */
function formatDate(d: Date): string {
    return d.toISOString().split('T')[0];
}
