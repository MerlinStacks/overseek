/**
 * ProductSearchInsightsPanel — Displays Google Search Console data for a single product.
 *
 * Shows the organic queries driving traffic to this product's URL, with
 * summary metrics (clicks, impressions, avg position, CTR) and a sortable
 * query table. Renders a connect prompt when GSC isn't linked, or an empty
 * state when no data exists for the product's URL.
 *
 * Why a separate component: isolates GSC data fetching and rendering from
 * the static SEO score logic, keeping both maintainable independently.
 */

import { useState } from 'react';
import {
    Search, TrendingUp, MousePointerClick, Eye, ArrowUpDown,
    Loader2, Link2, BarChart3, ChevronDown, ChevronUp
} from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import {
    useProductSearchInsights,
    type ProductQueryRow
} from '../../hooks/useProductSearchInsights';

type SortField = 'clicks' | 'impressions' | 'ctr' | 'position';
type SortDir = 'asc' | 'desc';

interface Props {
    permalink: string | undefined;
}

/**
 * Hero panel for the product SEO tab.
 * Fetches and displays page-scoped Search Console analytics.
 */
export function ProductSearchInsightsPanel({ permalink }: Props) {
    const { queries, summary, isLoading, isConnected, isStatusLoading } = useProductSearchInsights(permalink);
    const [sortField, setSortField] = useState<SortField>('clicks');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    if (isStatusLoading) {
        return <LoadingSkeleton />;
    }

    if (!isConnected) {
        return <ConnectPrompt />;
    }

    if (isLoading) {
        return <LoadingSkeleton />;
    }

    if (queries.length === 0) {
        return <EmptyState />;
    }

    const sorted = [...queries].sort((a, b) => {
        const mul = sortDir === 'desc' ? -1 : 1;
        return (a[sortField] - b[sortField]) * mul;
    });

    /** Toggle sort column; flip direction if same column clicked */
    const handleSort = (field: SortField) => {
        if (field === sortField) {
            setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
        } else {
            setSortField(field);
            setSortDir('desc');
        }
    };

    return (
        <div className="bg-white/70 dark:bg-slate-800/60 backdrop-blur-md rounded-xl shadow-xs border border-white/50 dark:border-slate-700/40 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 dark:border-slate-700/40 bg-white/50 dark:bg-slate-800/40">
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                            <BarChart3 className="text-blue-600 dark:text-blue-400" size={20} />
                            Organic Search Insights
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                            Queries driving organic traffic to this product (last 28 days).
                        </p>
                    </div>
                    <span className="text-xs font-medium text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-700/50 px-2.5 py-1 rounded-full">
                        {queries.length} {queries.length === 1 ? 'query' : 'queries'}
                    </span>
                </div>

                {/* Summary Cards */}
                {summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <SummaryCard
                            label="Clicks"
                            value={summary.totalClicks.toLocaleString()}
                            icon={MousePointerClick}
                            color="blue"
                        />
                        <SummaryCard
                            label="Impressions"
                            value={summary.totalImpressions.toLocaleString()}
                            icon={Eye}
                            color="violet"
                        />
                        <SummaryCard
                            label="Avg Position"
                            value={summary.avgPosition.toFixed(1)}
                            icon={TrendingUp}
                            color="emerald"
                        />
                        <SummaryCard
                            label="Avg CTR"
                            value={`${summary.avgCtr.toFixed(1)}%`}
                            icon={ArrowUpDown}
                            color="amber"
                        />
                    </div>
                )}
            </div>

            {/* Query Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-gray-50/80 dark:bg-slate-700/30 border-b border-gray-100 dark:border-slate-700/40">
                            <th className="text-left px-6 py-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                                Query
                            </th>
                            <SortableHeader field="clicks" current={sortField} dir={sortDir} onSort={handleSort}>
                                Clicks
                            </SortableHeader>
                            <SortableHeader field="impressions" current={sortField} dir={sortDir} onSort={handleSort}>
                                Impressions
                            </SortableHeader>
                            <SortableHeader field="ctr" current={sortField} dir={sortDir} onSort={handleSort}>
                                CTR
                            </SortableHeader>
                            <SortableHeader field="position" current={sortField} dir={sortDir} onSort={handleSort}>
                                Position
                            </SortableHeader>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700/40">
                        {sorted.map(row => (
                            <QueryRow key={row.query} row={row} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────── Sub-components ─── */

const COLOR_MAP = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    violet: 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
} as const;

function SummaryCard({ label, value, icon: Icon, color }: {
    label: string; value: string; icon: React.ElementType; color: keyof typeof COLOR_MAP;
}) {
    return (
        <div className={`rounded-lg px-4 py-3 ${COLOR_MAP[color]} bg-opacity-50`}>
            <div className="flex items-center gap-2 mb-1">
                <Icon size={14} />
                <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</span>
            </div>
            <span className="text-xl font-black">{value}</span>
        </div>
    );
}

function SortableHeader({ field, current, dir, onSort, children }: {
    field: SortField; current: SortField; dir: SortDir;
    onSort: (f: SortField) => void; children: React.ReactNode;
}) {
    const isActive = field === current;
    return (
        <th
            className="text-right px-6 py-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
            onClick={() => onSort(field)}
        >
            <span className="inline-flex items-center gap-1">
                {children}
                {isActive && (dir === 'desc'
                    ? <ChevronDown size={12} />
                    : <ChevronUp size={12} />
                )}
            </span>
        </th>
    );
}

function QueryRow({ row }: { row: ProductQueryRow }) {
    /** Position badge — green for page 1, amber for page 2, red for deeper */
    const posColor = row.position <= 10
        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
        : row.position <= 20
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';

    return (
        <tr className="hover:bg-gray-50/60 dark:hover:bg-slate-700/20 transition-colors">
            <td className="px-6 py-3 font-medium text-gray-900 dark:text-slate-200 max-w-xs truncate">
                {row.query}
            </td>
            <td className="px-6 py-3 text-right text-gray-700 dark:text-slate-300 font-semibold tabular-nums">
                {row.clicks.toLocaleString()}
            </td>
            <td className="px-6 py-3 text-right text-gray-600 dark:text-slate-400 tabular-nums">
                {row.impressions.toLocaleString()}
            </td>
            <td className="px-6 py-3 text-right text-gray-600 dark:text-slate-400 tabular-nums">
                {row.ctr.toFixed(1)}%
            </td>
            <td className="px-6 py-3 text-right">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${posColor}`}>
                    {row.position.toFixed(1)}
                </span>
            </td>
        </tr>
    );
}

/** Prompt shown when Search Console isn't connected */
function ConnectPrompt() {
    const api = useApi();
    const [loading, setLoading] = useState(false);

    const handleConnect = async () => {
        setLoading(true);
        try {
            const res = await api.get<{ authUrl: string }>('/api/oauth/search-console/authorize?redirect=/seo');
            window.location.href = res.authUrl;
        } catch {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white/70 dark:bg-slate-800/60 backdrop-blur-md rounded-xl shadow-xs border border-white/50 dark:border-slate-700/40 p-8">
            <div className="flex flex-col items-center justify-center py-8">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-violet-500/20 dark:from-blue-500/10 dark:to-violet-500/10 rounded-2xl flex items-center justify-center mb-4">
                    <Search className="w-8 h-8 text-blue-500 dark:text-blue-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-2">
                    Connect Search Console
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 text-center max-w-sm mb-6">
                    Link your Google Search Console to see which organic queries drive traffic to this product.
                </p>
                <button
                    onClick={handleConnect}
                    disabled={loading}
                    className="btn-gradient btn-shimmer flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    Connect Search Console
                </button>
            </div>
        </div>
    );
}

/** Empty state when GSC is connected but no data exists for this URL */
function EmptyState() {
    return (
        <div className="bg-white/70 dark:bg-slate-800/60 backdrop-blur-md rounded-xl shadow-xs border border-white/50 dark:border-slate-700/40 p-8">
            <div className="flex flex-col items-center justify-center py-8">
                <div className="w-16 h-16 bg-gray-100 dark:bg-slate-700/50 rounded-2xl flex items-center justify-center mb-4">
                    <BarChart3 className="w-8 h-8 text-gray-400 dark:text-slate-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-2">
                    No Organic Data Yet
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 text-center max-w-sm">
                    This product doesn't have any organic search impressions in the last 28 days.
                    Data will appear once Google indexes the page and users find it via search.
                </p>
            </div>
        </div>
    );
}

/** Skeleton loading state */
function LoadingSkeleton() {
    return (
        <div className="bg-white/70 dark:bg-slate-800/60 backdrop-blur-md rounded-xl shadow-xs border border-white/50 dark:border-slate-700/40 p-6 animate-pulse">
            <div className="flex items-center gap-3 mb-5">
                <div className="w-5 h-5 bg-gray-200 dark:bg-slate-700 rounded" />
                <div className="h-5 w-48 bg-gray-200 dark:bg-slate-700 rounded" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-16 bg-gray-100 dark:bg-slate-700/30 rounded-lg" />
                ))}
            </div>
            <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-10 bg-gray-100 dark:bg-slate-700/30 rounded" />
                ))}
            </div>
        </div>
    );
}
