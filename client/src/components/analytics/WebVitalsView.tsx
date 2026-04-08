/**
 * WebVitalsView — Real User Monitoring dashboard.
 *
 * Displays Core Web Vitals collected from real visitor sessions:
 * - Score cards with Google's p75 thresholds (good/needs-improvement/poor)
 * - Distribution bars showing the % of page loads in each band
 * - 30-day p75 trend line chart
 * - Per-page breakdown sorted by worst performer
 *
 * Why p75: Google's official CWV standard requires 75% of page loads to
 * pass the threshold to qualify as "good". We show p75 to match that assessment.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';
import { Loader2, Gauge, TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type VitalMetric = 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
type VitalRating = 'good' | 'needs-improvement' | 'poor';

interface VitalSummary {
    metric: VitalMetric;
    p75: number;
    p90: number;
    rating: VitalRating;
    sampleCount: number;
    distribution: { good: number; needsImprovement: number; poor: number };
    thresholds: { good: number; needsImprovement: number };
}

interface TimelineEntry {
    date: string;
    p75: number;
    sampleCount: number;
}

interface PageEntry {
    url: string;
    pageType: string;
    p75: number;
    sampleCount: number;
    rating: VitalRating;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const METRICS: VitalMetric[] = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];

const METRIC_META: Record<VitalMetric, { label: string; description: string; unit: string; googleUrl: string }> = {
    LCP:  { label: 'Largest Contentful Paint', description: 'How fast the main content loads', unit: 'ms', googleUrl: 'https://web.dev/lcp/' },
    CLS:  { label: 'Cumulative Layout Shift', description: 'How stable the page layout is', unit: '', googleUrl: 'https://web.dev/cls/' },
    INP:  { label: 'Interaction to Next Paint', description: 'How fast the page responds to clicks', unit: 'ms', googleUrl: 'https://web.dev/inp/' },
    FCP:  { label: 'First Contentful Paint', description: 'How fast something first appears', unit: 'ms', googleUrl: 'https://web.dev/fcp/' },
    TTFB: { label: 'Time to First Byte', description: 'How fast the server responds', unit: 'ms', googleUrl: 'https://web.dev/ttfb/' },
};

const PAGE_TYPE_FILTERS = [
    { key: 'all', label: 'All Pages' },
    { key: 'product', label: '🛍️ Product' },
    { key: 'category', label: '📂 Category' },
    { key: 'cart', label: '🛒 Cart' },
    { key: 'checkout', label: '💳 Checkout' },
    { key: 'home', label: '🏠 Home' },
    { key: 'other', label: 'Other' },
];

const RATING_CONFIG: Record<VitalRating, { label: string; bg: string; text: string; badge: string; bar: string }> = {
    'good':               { label: 'Good',               bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', badge: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
    'needs-improvement':  { label: 'Needs Work',         bg: 'bg-amber-50 dark:bg-amber-500/10',    text: 'text-amber-700 dark:text-amber-400',    badge: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',    bar: 'bg-amber-500' },
    'poor':               { label: 'Poor',               bg: 'bg-red-50 dark:bg-red-500/10',        text: 'text-red-700 dark:text-red-400',        badge: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',            bar: 'bg-red-500' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatValue(metric: VitalMetric, value: number): string {
    if (metric === 'CLS') return value.toFixed(3);
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
    return `${Math.round(value)}ms`;
}

function calcTrend(timeline: TimelineEntry[]): { direction: 'up' | 'down' | 'flat'; pct: number } {
    if (timeline.length < 4) return { direction: 'flat', pct: 0 };
    const half = Math.floor(timeline.length / 2);
    const first = timeline.slice(0, half).reduce((s, e) => s + e.p75, 0) / half;
    const last = timeline.slice(-half).reduce((s, e) => s + e.p75, 0) / half;
    const pct = first === 0 ? 0 : Math.abs((last - first) / first) * 100;
    // Higher value = worse performance (except CLS same rule)
    return { direction: pct < 2 ? 'flat' : last < first ? 'down' : 'up', pct };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreCard({ summary, isSelected, onClick }: {
    summary: VitalSummary;
    isSelected: boolean;
    onClick: () => void;
}) {
    const meta = METRIC_META[summary.metric];
    const rating = RATING_CONFIG[summary.rating];
    const total = summary.distribution.good + summary.distribution.needsImprovement + summary.distribution.poor;
    const goodPct = total > 0 ? (summary.distribution.good / total) * 100 : 0;
    const needsPct = total > 0 ? (summary.distribution.needsImprovement / total) * 100 : 0;
    const poorPct = total > 0 ? (summary.distribution.poor / total) * 100 : 0;

    return (
        <button
            onClick={onClick}
            className={`text-left w-full rounded-xl border p-4 transition-all ${
                isSelected
                    ? 'border-blue-400 dark:border-blue-500 shadow-md ring-2 ring-blue-400/30 dark:ring-blue-500/30'
                    : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
            } bg-white dark:bg-slate-800`}
        >
            <div className="flex items-start justify-between mb-3">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500 dark:text-slate-400 tracking-widest uppercase">{summary.metric}</span>
                        <a
                            href={meta.googleUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-gray-400 hover:text-blue-500 transition-colors"
                        >
                            <ExternalLink size={10} />
                        </a>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">{meta.description}</p>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${rating.badge}`}>
                    {summary.sampleCount > 0 ? rating.label : '—'}
                </span>
            </div>

            <div className="mb-3">
                <span className={`text-2xl font-bold ${summary.sampleCount > 0 ? rating.text : 'text-gray-400 dark:text-slate-500'}`}>
                    {summary.sampleCount > 0 ? formatValue(summary.metric, summary.p75) : '—'}
                </span>
                {summary.sampleCount > 0 && (
                    <span className="text-xs text-gray-400 dark:text-slate-500 ml-1">p75</span>
                )}
            </div>

            {/* Distribution bar */}
            {total > 0 ? (
                <div>
                    <div className="flex rounded-full overflow-hidden h-1.5 gap-px">
                        {goodPct > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${goodPct}%` }} />}
                        {needsPct > 0 && <div className="bg-amber-500 transition-all" style={{ width: `${needsPct}%` }} />}
                        {poorPct > 0 && <div className="bg-red-500 transition-all" style={{ width: `${poorPct}%` }} />}
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">{summary.sampleCount.toLocaleString()} samples</p>
                </div>
            ) : (
                <p className="text-[10px] text-gray-400 dark:text-slate-500">No data yet</p>
            )}
        </button>
    );
}

function TrendChart({ timeline, metric }: { timeline: TimelineEntry[]; metric: VitalMetric }) {
    if (timeline.length < 2) {
        return (
            <div className="h-32 flex items-center justify-center text-sm text-gray-400 dark:text-slate-500">
                Not enough data for a trend yet. Check back after more page loads.
            </div>
        );
    }

    const values = timeline.map(e => e.p75);
    const min = Math.min(...values) * 0.9;
    const max = Math.max(...values) * 1.1 || 1;
    const range = max - min || 1;
    const width = 600;
    const height = 120;
    const pad = { left: 48, right: 16, top: 8, bottom: 28 };

    const pts = timeline.map((e, i) => {
        const x = pad.left + (i / (timeline.length - 1)) * (width - pad.left - pad.right);
        const y = pad.top + (1 - (e.p75 - min) / range) * (height - pad.top - pad.bottom);
        return [x, y] as [number, number];
    });

    // Build smooth polyline path
    const path = pts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
    const area = `${path} L ${pts[pts.length - 1][0]} ${height - pad.bottom} L ${pts[0][0]} ${height - pad.bottom} Z`;

    const trend = calcTrend(timeline);
    const TrendIcon = trend.direction === 'down' ? TrendingDown : trend.direction === 'up' ? TrendingUp : Minus;
    // Lower is better for all metrics
    const trendGood = trend.direction === 'down';

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
                    {metric} p75 — 30-day trend
                </p>
                {trend.direction !== 'flat' && (
                    <div className={`flex items-center gap-1 text-xs font-medium ${trendGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                        <TrendIcon size={14} />
                        {trend.pct.toFixed(1)}% {trendGood ? 'improvement' : 'regression'}
                    </div>
                )}
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
                {/* Y gridlines */}
                {[0, 0.5, 1].map(t => {
                    const y = pad.top + (1 - t) * (height - pad.top - pad.bottom);
                    const val = min + t * range;
                    return (
                        <g key={t}>
                            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y}
                                stroke="currentColor" strokeOpacity="0.08" strokeDasharray="4,4" />
                            <text x={pad.left - 4} y={y + 4} textAnchor="end" fontSize="9"
                                fill="currentColor" fillOpacity="0.5">
                                {formatValue(metric, val)}
                            </text>
                        </g>
                    );
                })}

                {/* Area fill */}
                <path d={area} fill="url(#vitalGrad)" fillOpacity="0.15" />

                {/* Line */}
                <path d={path} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                {/* Data points */}
                {pts.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r="3" fill="#3b82f6" />
                ))}

                {/* X labels — show first, middle, last */}
                {[0, Math.floor(timeline.length / 2), timeline.length - 1].map(i => (
                    <text key={i} x={pts[i][0]} y={height - 4} textAnchor="middle" fontSize="9"
                        fill="currentColor" fillOpacity="0.5">
                        {timeline[i].date.slice(5)}
                    </text>
                ))}

                <defs>
                    <linearGradient id="vitalGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                </defs>
            </svg>
        </div>
    );
}

function PageBreakdownTable({ pages, metric }: { pages: PageEntry[]; metric: VitalMetric }) {
    if (!pages.length) {
        return <p className="text-sm text-gray-400 dark:text-slate-500 py-4">No page breakdown data yet.</p>;
    }

    const maxP75 = Math.max(...pages.map(p => p.p75));

    return (
        <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {pages.map((page) => {
                const rCfg = RATING_CONFIG[page.rating];
                const barWidth = maxP75 > 0 ? (page.p75 / maxP75) * 100 : 0;
                return (
                    <div key={page.url} className="flex items-center gap-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700/30 px-2 rounded-lg transition-colors">
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono text-gray-700 dark:text-slate-300 truncate">{page.url}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-gray-400 dark:text-slate-500 capitalize">{page.pageType}</span>
                                <span className="text-gray-300 dark:text-slate-600">·</span>
                                <span className="text-[10px] text-gray-400 dark:text-slate-500">{page.sampleCount} samples</span>
                            </div>
                        </div>
                        <div className="w-32 shrink-0">
                            <div className="h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${rCfg.bar}`}
                                    style={{ width: `${barWidth}%` }}
                                />
                            </div>
                        </div>
                        <div className="w-16 text-right shrink-0">
                            <span className={`text-sm font-semibold ${rCfg.text}`}>
                                {formatValue(metric, page.p75)}
                            </span>
                        </div>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${rCfg.badge}`}>
                            {rCfg.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WebVitalsView() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [summaries, setSummaries] = useState<VitalSummary[]>([]);
    const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
    const [pages, setPages] = useState<PageEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pageType, setPageType] = useState('all');
    const [selectedMetric, setSelectedMetric] = useState<VitalMetric>('LCP');

    const fetchAll = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        setError(null);

        // Headers built inside the callback so we always capture the current token.
        // Building them in render-scope would create a stale closure if the token refreshes.
        const headers = { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id };

        try {
            const [summaryRes, timelineRes, pagesRes] = await Promise.all([
                fetch(`/api/web-vitals/summary?days=30&pageType=${pageType}`, { headers }),
                fetch(`/api/web-vitals/timeline?metric=${selectedMetric}&days=30`, { headers }),
                fetch(`/api/web-vitals/pages?days=30&metric=${selectedMetric}&limit=20`, { headers }),
            ]);

            if (!summaryRes.ok || !timelineRes.ok || !pagesRes.ok) {
                throw new Error('Failed to fetch vitals data');
            }

            const [summaryData, timelineData, pagesData] = await Promise.all([
                summaryRes.json(),
                timelineRes.json(),
                pagesRes.json(),
            ]);

            setSummaries(summaryData.summaries || []);
            setTimeline(timelineData.timeline || []);
            setPages(pagesData.pages || []);
        } catch (err) {
            Logger.error('Failed to fetch web vitals', { error: err });
            setError('Failed to load performance data');
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token, pageType, selectedMetric]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    if (!currentAccount) return null;

    const totalSamples = summaries.reduce((s, v) => s + v.sampleCount, 0);
    const goodCount = summaries.filter(v => v.rating === 'good' && v.sampleCount > 0).length;
    const overallRating: VitalRating = 
        summaries.length === 0 || totalSamples === 0 ? 'good'
        : goodCount === summaries.filter(v => v.sampleCount > 0).length ? 'good'
        : summaries.some(v => v.rating === 'poor' && v.sampleCount > 0) ? 'poor'
        : 'needs-improvement';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-500/20 rounded-lg">
                            <Gauge className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Real User Performance</h2>
                            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                                Core Web Vitals from real visitor sessions · Last 30 days ·{' '}
                                {totalSamples > 0
                                    ? `${totalSamples.toLocaleString()} page loads measured`
                                    : 'Collecting data from your live store'}
                            </p>
                        </div>
                    </div>

                    {/* Overall badge */}
                    {totalSamples > 0 && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${RATING_CONFIG[overallRating].badge}`}>
                            {overallRating === 'good' ? '✅' : overallRating === 'poor' ? '🔴' : '🟡'}
                            {RATING_CONFIG[overallRating].label}
                        </div>
                    )}
                </div>

                {/* Page type filter */}
                <div className="flex gap-2 flex-wrap mt-4">
                    {PAGE_TYPE_FILTERS.map(f => (
                        <button
                            key={f.key}
                            onClick={() => setPageType(f.key)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                                pageType === f.key
                                    ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
                                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
                    {error}
                </div>
            )}

            {isLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-400 dark:text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Loading performance data...
                </div>
            ) : (
                <>
                    {/* Score Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        {METRICS.map(metric => {
                            const summary = summaries.find(s => s.metric === metric) || {
                                metric,
                                p75: 0, p90: 0,
                                rating: 'good' as VitalRating,
                                sampleCount: 0,
                                distribution: { good: 0, needsImprovement: 0, poor: 0 },
                                thresholds: { good: 0, needsImprovement: 0 },
                            };
                            return (
                                <ScoreCard
                                    key={metric}
                                    summary={summary}
                                    isSelected={selectedMetric === metric}
                                    onClick={() => setSelectedMetric(metric)}
                                />
                            );
                        })}
                    </div>

                    {/* Trend + Pages */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Trend Chart */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
                            <TrendChart timeline={timeline} metric={selectedMetric} />
                        </div>

                        {/* Distribution Detail */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
                            <p className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-4">
                                {selectedMetric} distribution
                            </p>
                            {(() => {
                                const s = summaries.find(x => x.metric === selectedMetric);
                                if (!s || s.sampleCount === 0) {
                                    return <p className="text-sm text-gray-400 dark:text-slate-500">No data yet for this metric.</p>;
                                }
                                const total = s.distribution.good + s.distribution.needsImprovement + s.distribution.poor;
                                const bands = [
                                    { label: `Good (≤ ${formatValue(selectedMetric, s.thresholds.good)})`, count: s.distribution.good, color: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
                                    { label: `Needs work (≤ ${formatValue(selectedMetric, s.thresholds.needsImprovement)})`, count: s.distribution.needsImprovement, color: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
                                    { label: `Poor (> ${formatValue(selectedMetric, s.thresholds.needsImprovement)})`, count: s.distribution.poor, color: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
                                ];
                                return (
                                    <div className="space-y-3">
                                        {bands.map(band => {
                                            const pct = total > 0 ? (band.count / total) * 100 : 0;
                                            return (
                                                <div key={band.label}>
                                                    <div className="flex justify-between text-xs mb-1">
                                                        <span className="text-gray-600 dark:text-slate-400">{band.label}</span>
                                                        <span className={`font-semibold ${band.text}`}>{pct.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all ${band.color}`}
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{band.count.toLocaleString()} page loads</p>
                                                </div>
                                            );
                                        })}
                                        <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
                                            <p className="text-xs text-gray-500 dark:text-slate-400">
                                                p90: <span className="font-semibold">{formatValue(selectedMetric, s.p90)}</span>
                                                <span className="ml-2 text-gray-400">(90% of loads faster than this)</span>
                                            </p>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Slowest Pages */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="text-sm font-medium text-gray-700 dark:text-slate-300">
                                Slowest pages by {selectedMetric} p75
                            </h3>
                            <span className="text-xs text-gray-400 dark:text-slate-500">Top 20 · Last 30 days</span>
                        </div>
                        <div className="p-4">
                            <PageBreakdownTable pages={pages} metric={selectedMetric} />
                        </div>
                    </div>

                    {totalSamples === 0 && (
                        <div className="text-center py-10 text-gray-400 dark:text-slate-500">
                            <Gauge className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p className="font-medium text-gray-600 dark:text-slate-300">No performance data yet</p>
                            <p className="text-sm mt-1">
                                Make sure Web Vitals Collection is enabled in your WooCommerce plugin settings,
                                then visit a few pages on your store to start collecting data.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
