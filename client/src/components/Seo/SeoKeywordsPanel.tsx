/**
 * SeoKeywordsPanel — Dashboard for Search Console keyword insights.
 *
 * Renders four sub-panels: low-hanging fruit, keyword gaps,
 * trending keywords, and AI recommendations.
 * Shows a connect prompt when Search Console isn't linked yet.
 *
 * Why glassmorphism cards: matches the app-wide premium design system
 * using glass-panel utility, Card component, and slate palette.
 */

import { useState } from 'react';
import {
    TrendingUp, Target, Search, Sparkles,
    ArrowUpRight, ArrowDown, ExternalLink, Loader2, Link2
} from 'lucide-react';
import {
    useSearchConsoleStatus,
    useKeywordRecommendations,
    useKeywordTrends,
    useSearchAnalytics,
} from '../../hooks/useSeoKeywords';
import type {
    QueryAnalytics,
    LowHangingFruit,
    KeywordGap,
    QueryTrend,
    AIKeywordRecommendation,
} from '../../hooks/useSeoKeywords';
import { useApi } from '../../hooks/useApi';

/** Priority badge color mapping */
const PRIORITY_COLORS = {
    high: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50',
    medium: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50',
    low: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/50',
} as const;

/** Effort badge color mapping */
const EFFORT_COLORS = {
    low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    high: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
} as const;

const ACTION_ICONS = {
    content: Sparkles,
    optimization: Target,
    technical: Search,
    trend: TrendingUp,
} as const;

export function SeoKeywordsPanel({ siteUrl }: { siteUrl?: string }) {
    const status = useSearchConsoleStatus();
    const isConnected = status.data?.connected;

    if (status.isLoading) {
        return <LoadingState />;
    }

    if (!isConnected) {
        return <ConnectPrompt />;
    }

    return (
        <div className="space-y-6">
            <SummaryBar siteUrl={siteUrl} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <LowHangingFruitPanel siteUrl={siteUrl} />
                <TrendingPanel siteUrl={siteUrl} />
            </div>
            <KeywordGapsPanel siteUrl={siteUrl} />
            <AIRecommendationsPanel siteUrl={siteUrl} />
        </div>
    );
}

/** Prompt shown when Search Console isn't connected yet */
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
        <div className="flex flex-col items-center justify-center py-20 px-6">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500/20 to-violet-500/20 dark:from-blue-500/10 dark:to-violet-500/10 rounded-3xl flex items-center justify-center mb-6 animate-float">
                <Search className="w-10 h-10 text-blue-500 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
                Connect Google Search Console
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-8">
                Link your Search Console to get AI-powered keyword recommendations,
                discover low-hanging fruit opportunities, and track trending search queries.
            </p>
            <button
                onClick={handleConnect}
                disabled={loading}
                className="btn-gradient btn-shimmer flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-base disabled:opacity-50"
            >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Link2 className="w-5 h-5" />}
                Connect Search Console
            </button>
        </div>
    );
}

/** Summary stats bar across the top */
function SummaryBar({ siteUrl }: { siteUrl?: string }) {
    const { data } = useSearchAnalytics(28, siteUrl);

    if (!data?.queries?.length) return null;

    const totalClicks = data.queries.reduce((s: number, q: QueryAnalytics) => s + q.clicks, 0);
    const totalImpressions = data.queries.reduce((s: number, q: QueryAnalytics) => s + q.impressions, 0);
    const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0';
    const avgPos = data.queries.length > 0
        ? (data.queries.reduce((s: number, q: QueryAnalytics) => s + q.position, 0) / data.queries.length).toFixed(1)
        : '0';

    const stats = [
        { label: 'Total Clicks', value: totalClicks.toLocaleString(), color: 'from-blue-500 to-blue-600' },
        { label: 'Impressions', value: totalImpressions.toLocaleString(), color: 'from-violet-500 to-violet-600' },
        { label: 'Avg CTR', value: `${avgCtr}%`, color: 'from-emerald-500 to-emerald-600' },
        { label: 'Avg Position', value: avgPos, color: 'from-amber-500 to-amber-600' },
        { label: 'Tracked Queries', value: data.count.toString(), color: 'from-rose-500 to-rose-600' },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {stats.map((s, i) => (
                <div
                    key={s.label}
                    className={`glass-panel rounded-2xl p-4 relative overflow-hidden animate-fade-slide-up animation-delay-${i * 100}`}
                >
                    {/* Subtle colored accent */}
                    <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${s.color}`} />
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-medium">{s.label}</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">{s.value}</p>
                </div>
            ))}
        </div>
    );
}

/** Low-hanging fruit: keywords position 5-20 with upside potential */
function LowHangingFruitPanel({ siteUrl }: { siteUrl?: string }) {
    const { data, isLoading } = useKeywordRecommendations(siteUrl);
    const items = data?.lowHangingFruit || [];

    return (
        <PanelCard
            title="Low-Hanging Fruit"
            subtitle="Keywords ranking 5–20 with growth potential"
            icon={Target}
            iconColor="text-orange-500 dark:text-orange-400"
            iconBg="bg-orange-100 dark:bg-orange-900/30"
            loading={isLoading}
        >
            {items.length === 0 ? (
                <EmptyPanel message="No low-hanging fruit found. Connect more data or check back later." />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700/50">
                                <th className="pb-2 font-medium">Keyword</th>
                                <th className="pb-2 font-medium text-right">Position</th>
                                <th className="pb-2 font-medium text-right">Impressions</th>
                                <th className="pb-2 font-medium text-right">CTR</th>
                                <th className="pb-2 font-medium text-right">Upside</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.slice(0, 10).map((item: LowHangingFruit) => (
                                <tr key={item.query} className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition-colors">
                                    <td className="py-2.5 font-medium text-slate-900 dark:text-slate-200">{item.query}</td>
                                    <td className="py-2.5 text-right">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                            #{Math.round(item.position)}
                                        </span>
                                    </td>
                                    <td className="py-2.5 text-right text-slate-600 dark:text-slate-400">{item.impressions.toLocaleString()}</td>
                                    <td className="py-2.5 text-right text-slate-600 dark:text-slate-400">{item.ctr}%</td>
                                    <td className="py-2.5 text-right">
                                        <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center justify-end gap-1">
                                            <ArrowUpRight className="w-3 h-3" />
                                            +{item.estimatedUpside} clicks
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </PanelCard>
    );
}

/** Trending keywords: rising queries with impression growth */
function TrendingPanel({ siteUrl }: { siteUrl?: string }) {
    const { data, isLoading } = useKeywordTrends(siteUrl);
    const items = data?.trends || [];

    return (
        <PanelCard
            title="Trending Keywords"
            subtitle="Queries gaining traction this period"
            icon={TrendingUp}
            iconColor="text-green-500 dark:text-green-400"
            iconBg="bg-green-100 dark:bg-green-900/30"
            loading={isLoading}
        >
            {items.length === 0 ? (
                <EmptyPanel message="No significant trending keywords detected yet." />
            ) : (
                <div className="space-y-1">
                    {items.slice(0, 8).map((item: QueryTrend) => (
                        <div key={item.query} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-slate-900 dark:text-slate-200 truncate">{item.query}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {item.currentClicks} clicks · pos #{item.currentPosition}
                                </p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-3">
                                <span className={`text-sm font-semibold flex items-center gap-1 ${item.impressionGrowthPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                                    }`}>
                                    {item.impressionGrowthPct > 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                                    {item.impressionGrowthPct > 0 ? '+' : ''}{item.impressionGrowthPct}%
                                </span>
                                {item.positionChange > 0 && (
                                    <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                                        ↑{item.positionChange} pos
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </PanelCard>
    );
}

/** Keyword gaps: products without organic coverage */
function KeywordGapsPanel({ siteUrl }: { siteUrl?: string }) {
    const { data, isLoading } = useKeywordRecommendations(siteUrl);
    const items = data?.keywordGaps || [];

    if (!isLoading && items.length === 0) return null;

    return (
        <PanelCard
            title="Keyword Gaps"
            subtitle="Products without organic search coverage"
            icon={Search}
            iconColor="text-purple-500 dark:text-purple-400"
            iconBg="bg-purple-100 dark:bg-purple-900/30"
            loading={isLoading}
        >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {items.slice(0, 9).map((item: KeywordGap, i: number) => (
                    <div key={i} className="border border-slate-100 dark:border-slate-700/50 rounded-xl p-4 hover:border-slate-200 dark:hover:border-slate-600 hover:shadow-sm transition-all duration-200">
                        <div className="flex items-start justify-between mb-2">
                            <h4 className="font-medium text-slate-900 dark:text-slate-200 text-sm truncate flex-1">{item.productName}</h4>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ml-2 shrink-0 ${PRIORITY_COLORS[item.priority]}`}>
                                {item.priority}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{item.productCategory}</p>
                        <div className="flex flex-wrap gap-1.5">
                            {item.suggestedKeywords.map(kw => (
                                <span key={kw} className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-md">
                                    {kw}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </PanelCard>
    );
}

/** AI-generated strategic recommendations */
function AIRecommendationsPanel({ siteUrl }: { siteUrl?: string }) {
    const { data, isLoading } = useKeywordRecommendations(siteUrl);
    const items = data?.aiRecommendations || [];

    if (!isLoading && items.length === 0) return null;

    return (
        <PanelCard
            title="AI Recommendations"
            subtitle="Strategic keyword opportunities powered by AI"
            icon={Sparkles}
            iconColor="text-indigo-500 dark:text-indigo-400"
            iconBg="bg-indigo-100 dark:bg-indigo-900/30"
            loading={isLoading}
        >
            <div className="space-y-4">
                {items.map((item: AIKeywordRecommendation, i: number) => {
                    const Icon = ACTION_ICONS[item.actionType] || Sparkles;
                    return (
                        <div key={i} className="border border-slate-100 dark:border-slate-700/50 rounded-xl p-4 hover:border-slate-200 dark:hover:border-slate-600 hover:shadow-sm transition-all duration-200">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                                    <Icon className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</h4>
                                        <span className={`text-xs px-2 py-0.5 rounded-full border ${PRIORITY_COLORS[item.priority]}`}>
                                            {item.priority}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${EFFORT_COLORS[item.effort]}`}>
                                            {item.effort} effort
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{item.description}</p>
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {item.keywords.map(kw => (
                                            <span key={kw} className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-md font-medium">
                                                {kw}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                        <ExternalLink className="w-3 h-3" />
                                        {item.expectedImpact}
                                    </p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </PanelCard>
    );
}

/* ─────────────────────────────────────── Shared components ─── */

function PanelCard({ title, subtitle, icon: Icon, iconColor, iconBg, loading, children }: {
    title: string;
    subtitle: string;
    icon: React.ElementType;
    iconColor: string;
    iconBg: string;
    loading?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="glass-panel rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-5">
                <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
                </div>
            </div>
            {loading ? (
                <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-6 h-6 text-slate-400 dark:text-slate-500 animate-spin" />
                </div>
            ) : children}
        </div>
    );
}

function EmptyPanel({ message }: { message: string }) {
    return (
        <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">{message}</p>
    );
}

function LoadingState() {
    return (
        <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-slate-400 dark:text-slate-500 animate-spin" />
        </div>
    );
}
