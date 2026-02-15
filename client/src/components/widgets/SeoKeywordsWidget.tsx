/**
 * SeoKeywordsWidget — Dashboard widget for at-a-glance SEO keyword health.
 *
 * Why a separate widget: Lets users monitor organic search directly from the
 * dashboard without navigating to the full SEO page. Self-gates on GSC
 * connection status so no server permission guard is needed.
 */

import { WidgetProps } from './WidgetRegistry';
import {
    useSearchConsoleStatus,
    useSearchAnalytics,
    useKeywordTrends,
} from '../../hooks/useSeoKeywords';
import type { QueryAnalytics, QueryTrend } from '../../hooks/useSeoKeywords';
import {
    Search,
    TrendingUp,
    TrendingDown,
    ArrowRight,
    Loader2,
    MousePointerClick,
    Eye,
    Crosshair,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** Position badge color based on ranking bucket */
function positionColor(pos: number): string {
    if (pos <= 3) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
    if (pos <= 10) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400';
    if (pos <= 20) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
    return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400';
}

export function SeoKeywordsWidget({ className }: WidgetProps) {
    const navigate = useNavigate();
    const { data: status, isLoading: statusLoading } = useSearchConsoleStatus();
    const connected = status?.connected ?? false;

    const { data: analyticsData, isLoading: analyticsLoading } = useSearchAnalytics(28);
    const { data: trendsData, isLoading: trendsLoading } = useKeywordTrends();

    const isLoading = statusLoading || (connected && (analyticsLoading || trendsLoading));

    const queries: QueryAnalytics[] = analyticsData?.queries ?? [];
    const topKeywords = [...queries].sort((a, b) => b.clicks - a.clicks).slice(0, 5);

    /* Pick the top 3 trending keywords by biggest position improvement (negative positionChange = improvement) */
    const trends: QueryTrend[] = trendsData?.trends ?? [];
    const topMovers = [...trends]
        .sort((a, b) => a.positionChange - b.positionChange)
        .slice(0, 3);

    /* Aggregate stats */
    const totalClicks = queries.reduce((sum, q) => sum + q.clicks, 0);
    const totalImpressions = queries.reduce((sum, q) => sum + q.impressions, 0);
    const avgPosition = queries.length > 0
        ? queries.reduce((sum, q) => sum + q.position, 0) / queries.length
        : 0;

    return (
        <div
            className={`bg-white dark:bg-slate-800/90 h-full w-full p-5 flex flex-col rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 overflow-hidden transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${className}`}
        >
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-slate-900 dark:text-white">SEO Keywords</h3>
                <div className="p-2 bg-gradient-to-br from-blue-400 to-cyan-600 rounded-lg text-white shadow-md shadow-cyan-500/20">
                    <Search size={16} />
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto space-y-4">
                {isLoading ? (
                    <div className="flex justify-center p-4">
                        <Loader2 className="animate-spin text-slate-400" />
                    </div>
                ) : !connected ? (
                    <NotConnectedPrompt onNavigate={() => navigate('/seo')} />
                ) : queries.length === 0 ? (
                    <div className="text-center text-slate-400 dark:text-slate-500 py-4 text-sm">
                        No keyword data yet
                    </div>
                ) : (
                    <>
                        {/* Summary Stats */}
                        <div className="grid grid-cols-3 gap-2">
                            <StatPill
                                icon={<MousePointerClick size={12} />}
                                label="Clicks"
                                value={totalClicks.toLocaleString()}
                                color="text-blue-600 dark:text-blue-400"
                                bg="bg-blue-50 dark:bg-blue-900/20"
                            />
                            <StatPill
                                icon={<Eye size={12} />}
                                label="Impressions"
                                value={formatCompact(totalImpressions)}
                                color="text-violet-600 dark:text-violet-400"
                                bg="bg-violet-50 dark:bg-violet-900/20"
                            />
                            <StatPill
                                icon={<Crosshair size={12} />}
                                label="Avg Pos"
                                value={avgPosition.toFixed(1)}
                                color="text-emerald-600 dark:text-emerald-400"
                                bg="bg-emerald-50 dark:bg-emerald-900/20"
                            />
                        </div>

                        {/* Top Keywords */}
                        <div className="space-y-1.5">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                Top Keywords
                            </span>
                            {topKeywords.map((kw, idx) => (
                                <div
                                    key={kw.query}
                                    className="flex justify-between items-center text-sm px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                                >
                                    <div className="flex gap-2 items-center overflow-hidden">
                                        <span className="text-[10px] font-bold text-slate-400 w-4 text-right shrink-0">
                                            {idx + 1}
                                        </span>
                                        <span className="font-medium text-slate-800 dark:text-slate-200 truncate" title={kw.query}>
                                            {kw.query}
                                        </span>
                                    </div>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${positionColor(kw.position)}`}>
                                        #{Math.round(kw.position)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Trending Movers */}
                        {topMovers.length > 0 && (
                            <div className="space-y-1.5">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                    Trending Movers
                                </span>
                                {topMovers.map((mv) => {
                                    const improved = mv.positionChange < 0;
                                    return (
                                        <div
                                            key={mv.query}
                                            className="flex justify-between items-center text-sm px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                                        >
                                            <span className="font-medium text-slate-800 dark:text-slate-200 truncate" title={mv.query}>
                                                {mv.query}
                                            </span>
                                            <span
                                                className={`flex items-center gap-0.5 text-xs font-bold shrink-0 ${improved
                                                    ? 'text-emerald-600 dark:text-emerald-400'
                                                    : 'text-rose-500 dark:text-rose-400'
                                                    }`}
                                            >
                                                {improved ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                {Math.abs(mv.positionChange).toFixed(1)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Footer link */}
                        <button
                            onClick={() => navigate('/seo')}
                            className="w-full text-center text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center justify-center gap-1 pt-1 transition-colors"
                        >
                            View full SEO dashboard <ArrowRight size={12} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

/* ─── Sub-components ────────────────────────────────── */

/** Compact stat pill for the top summary row */
function StatPill({ icon, label, value, color, bg }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    color: string;
    bg: string;
}) {
    return (
        <div className={`${bg} rounded-xl px-2.5 py-2 flex flex-col items-center gap-0.5`}>
            <span className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${color}`}>
                {icon} {label}
            </span>
            <span className={`text-base font-bold ${color}`}>{value}</span>
        </div>
    );
}

/** Prompt shown when GSC is not connected */
function NotConnectedPrompt({ onNavigate }: { onNavigate: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center text-center gap-3 py-6">
            <div className="p-3 rounded-full bg-slate-100 dark:bg-slate-700">
                <Search size={20} className="text-slate-400 dark:text-slate-500" />
            </div>
            <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Google Search Console not connected
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    Connect GSC to see keyword data here.
                </p>
            </div>
            <button
                onClick={onNavigate}
                className="text-xs font-semibold text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
            >
                Go to SEO page <ArrowRight size={12} />
            </button>
        </div>
    );
}

/** Format large numbers compactly (e.g. 12345 → 12.3K) */
function formatCompact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}
