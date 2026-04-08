/**
 * WebVitals Service
 *
 * Handles ingestion and percentile-based querying of Core Web Vital
 * measurements collected from real user sessions via the WC plugin.
 *
 * Why per-sample storage (not daily aggregates): p75 calculations require
 * the full value distribution. Averaging destroys the tail data that matters
 * most for performance budgets and Google's CWV assessment.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export const VITAL_METRICS = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'] as const;
export type VitalMetric = typeof VITAL_METRICS[number];

/** Google's Core Web Vitals thresholds */
export const VITAL_THRESHOLDS: Record<VitalMetric, { good: number; needsImprovement: number }> = {
    LCP:  { good: 2500,  needsImprovement: 4000  },
    CLS:  { good: 0.1,   needsImprovement: 0.25  },
    INP:  { good: 200,   needsImprovement: 500   },
    FCP:  { good: 1800,  needsImprovement: 3000  },
    TTFB: { good: 800,   needsImprovement: 1800  },
};

export interface VitalSampleInput {
    metric: string;
    value: number;
    rating: string;
    url: string;
    pageType: string;
    device: string;
    effectiveType?: string;
}

export interface VitalSummary {
    metric: VitalMetric;
    p75: number;
    p90: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    sampleCount: number;
    distribution: { good: number; needsImprovement: number; poor: number };
    thresholds: { good: number; needsImprovement: number };
}

export interface VitalsTimelineEntry {
    date: string;
    p75: number;
    sampleCount: number;
}

export interface PageVitalEntry {
    url: string;
    pageType: string;
    p75: number;
    sampleCount: number;
    rating: 'good' | 'needs-improvement' | 'poor';
}

/**
 * Compute rating from value against Google's thresholds.
 */
function computeRating(metric: VitalMetric, value: number): 'good' | 'needs-improvement' | 'poor' {
    const t = VITAL_THRESHOLDS[metric];
    if (value <= t.good) return 'good';
    if (value <= t.needsImprovement) return 'needs-improvement';
    return 'poor';
}

/**
 * Compute the p75 percentile from a sorted array of numbers.
 * Why p75: This is Google's standard for Core Web Vitals assessment —
 * 75% of page loads must pass the threshold to qualify as "good".
 */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p / 100) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Sanitize URL to path-only (no query string, no fragment).
 * Strips PII from query params while preserving the meaningful path.
 */
function sanitizeUrl(raw: string): string {
    try {
        const url = new URL(raw, 'http://x');
        return url.pathname.substring(0, 500);
    } catch {
        return raw.substring(0, 500);
    }
}

/**
 * Batch-insert Web Vital samples for a single page load.
 * Max 10 samples per call to prevent abuse.
 *
 * @param accountId - Account to record samples under
 * @param samples   - Array of measurements (usually 5: LCP, CLS, INP, FCP, TTFB)
 */
export async function ingestVitals(accountId: string, samples: VitalSampleInput[]): Promise<void> {
    if (!samples?.length) return;

    // Clamp to 10 samples maximum per call
    const limited = samples.slice(0, 10);
    const validMetrics = new Set(VITAL_METRICS as readonly string[]);

    const rows = limited
        .filter(s => validMetrics.has(s.metric) && typeof s.value === 'number' && isFinite(s.value))
        .map(s => ({
            accountId,
            metric:        s.metric,
            value:         Math.max(0, s.value),  // Clamp negatives
            rating:        ['good', 'needs-improvement', 'poor'].includes(s.rating) ? s.rating : 'poor',
            url:           sanitizeUrl(s.url || '/'),
            pageType:      ['product', 'category', 'cart', 'checkout', 'home', 'other'].includes(s.pageType) ? s.pageType : 'other',
            device:        ['mobile', 'tablet', 'desktop'].includes(s.device) ? s.device : 'desktop',
            effectiveType: s.effectiveType || null,
        }));

    if (!rows.length) return;

    await prisma.webVitalSample.createMany({ data: rows });
    Logger.debug('[WebVitals] Ingested samples', { accountId, count: rows.length });
}

/**
 * Get p75/p90 summary per metric for the dashboard.
 *
 * @param accountId - Account to query
 * @param days      - Lookback period (default 30)
 * @param pageType  - Filter by page type, or 'all' for all types
 */
export async function getVitalsSummary(
    accountId: string,
    days = 30,
    pageType = 'all'
): Promise<VitalSummary[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = {
        accountId,
        createdAt: { gte: since },
        ...(pageType !== 'all' ? { pageType } : {}),
    };

    // Single query fetching all 5 metrics at once, avoiding N+1 serial calls.
    // Prisma fetches are parallelised at the DB level via a single round-trip.
    const allSamples = await prisma.webVitalSample.findMany({
        where,
        select: { metric: true, value: true, rating: true },
        orderBy: { value: 'asc' },
    });

    // Group in-memory — the result set is bounded by days × metrics × samples/day
    const grouped = new Map<VitalMetric, { value: number; rating: string }[]>();
    for (const metric of VITAL_METRICS) grouped.set(metric, []);
    for (const s of allSamples) {
        const bucket = grouped.get(s.metric as VitalMetric);
        if (bucket) bucket.push({ value: s.value, rating: s.rating });
    }

    const summaries: VitalSummary[] = [];

    for (const metric of VITAL_METRICS) {
        const samples = grouped.get(metric) ?? [];

        if (!samples.length) {
            summaries.push({
                metric,
                p75: 0,
                p90: 0,
                rating: 'good',
                sampleCount: 0,
                distribution: { good: 0, needsImprovement: 0, poor: 0 },
                thresholds: VITAL_THRESHOLDS[metric],
            });
            continue;
        }

        // Values arrive unsorted since we fetched all metrics in one go
        const values = samples.map(s => s.value).sort((a, b) => a - b);
        const p75 = percentile(values, 75);
        const p90 = percentile(values, 90);

        const distribution = samples.reduce(
            (acc, s) => {
                if (s.rating === 'good') acc.good++;
                else if (s.rating === 'needs-improvement') acc.needsImprovement++;
                else acc.poor++;
                return acc;
            },
            { good: 0, needsImprovement: 0, poor: 0 }
        );

        summaries.push({
            metric,
            p75,
            p90,
            rating: computeRating(metric, p75),
            sampleCount: samples.length,
            distribution,
            thresholds: VITAL_THRESHOLDS[metric],
        });
    }

    return summaries;
}

/**
 * Get daily p75 trend for a single metric.
 * Used to power the trend line chart on the dashboard.
 *
 * @param accountId - Account to query
 * @param metric    - Which metric to trend
 * @param days      - Lookback period (max 90)
 */
export async function getVitalsTimeline(
    accountId: string,
    metric: VitalMetric,
    days = 30
): Promise<VitalsTimelineEntry[]> {
    const cappedDays = Math.min(days, 90);

    // Use raw SQL DATE_TRUNC to group by day on the DB side.
    // Why: avoids loading potentially 100K+ rows into Node memory for grouping.
    // We still compute p75 in JS because Postgres lacks a native percentile_cont
    // that works easily with Prisma's raw query return type.
    const since = new Date(Date.now() - cappedDays * 24 * 60 * 60 * 1000);

    const rows = await prisma.$queryRaw<{ day: Date; value: number }[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, value
        FROM "WebVitalSample"
        WHERE "accountId" = ${accountId}
          AND metric = ${metric}
          AND "createdAt" >= ${since}
        ORDER BY day ASC
    `;

    // Group values by day string
    const byDate = new Map<string, number[]>();
    for (const row of rows) {
        const date = new Date(row.day).toISOString().substring(0, 10);
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push(Number(row.value));
    }

    return Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({
            date,
            p75: percentile(values.sort((a, b) => a - b), 75),
            sampleCount: values.length,
        }));
}

/**
 * Get per-URL p75 breakdown — the slowest pages.
 * Returns top urls sorted by LCP p75 descending.
 *
 * @param accountId - Account to query
 * @param days      - Lookback period
 * @param metric    - Metric to sort by (default LCP)
 * @param limit     - Max pages to return
 */
export async function getVitalsByPage(
    accountId: string,
    days = 30,
    metric: VitalMetric = 'LCP',
    limit = 20
): Promise<PageVitalEntry[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const samples = await prisma.webVitalSample.findMany({
        where: { accountId, metric, createdAt: { gte: since } },
        select: { url: true, pageType: true, value: true },
        orderBy: { value: 'asc' },
    });

    // Group by URL
    const byUrl = new Map<string, { pageType: string; values: number[] }>();
    for (const s of samples) {
        if (!byUrl.has(s.url)) byUrl.set(s.url, { pageType: s.pageType, values: [] });
        byUrl.get(s.url)!.values.push(s.value);
    }

    // Compute p75 per URL, sort descending, take top N
    return Array.from(byUrl.entries())
        .map(([url, { pageType, values }]) => {
            const sorted = values.sort((a, b) => a - b);
            const p75 = percentile(sorted, 75);
            return { url, pageType, p75, sampleCount: values.length, rating: computeRating(metric, p75) };
        })
        .sort((a, b) => b.p75 - a.p75)
        .slice(0, limit);
}

/**
 * Delete Web Vital samples older than 90 days.
 * Called by MaintenanceScheduler nightly.
 */
export async function cleanupOldSamples(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = await prisma.webVitalSample.deleteMany({
        where: { createdAt: { lt: cutoff } },
    });
    Logger.info('[WebVitals] Cleanup complete', { deleted: result.count });
    return result.count;
}
