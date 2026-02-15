/**
 * KeywordTrackerPanel — SEO command center with sub-tabbed interface.
 *
 * Sub-tabs: Keywords (list+chart), Groups, Competitors, Revenue, Health, Digest.
 * Also includes bulk import functionality.
 */

import { useState, useMemo } from 'react';
import {
    Plus, Trash2, RefreshCw, TrendingUp, TrendingDown,
    Loader2, Search, ChevronRight, Minus, X, Sparkles,
    FolderOpen, Users, DollarSign, ShieldCheck, Mail, Upload
} from 'lucide-react';
import {
    useTrackedKeywords,
    useKeywordHistory,
    useAddKeyword,
    useDeleteKeyword,
    useRefreshKeywords,
    useSearchConsoleStatus,
    useKeywordRecommendations,
    useBulkImportKeywords,
} from '../../hooks/useSeoKeywords';
import type { TrackedKeywordSummary, RankHistoryPoint } from '../../hooks/useSeoKeywords';
import { KeywordGroupsTab } from './KeywordGroupsTab';
import { CompetitorTab } from './CompetitorTab';
import { RevenueTab } from './RevenueTab';
import { HealthTab } from './HealthTab';
import { DigestTab } from './DigestTab';

type TrackerSubTab = 'keywords' | 'groups' | 'competitors' | 'revenue' | 'health' | 'digest';

const SUB_TABS: { id: TrackerSubTab; label: string; icon: React.ElementType }[] = [
    { id: 'keywords', label: 'Keywords', icon: Search },
    { id: 'groups', label: 'Groups', icon: FolderOpen },
    { id: 'competitors', label: 'Competitors', icon: Users },
    { id: 'revenue', label: 'Revenue', icon: DollarSign },
    { id: 'health', label: 'Health', icon: ShieldCheck },
    { id: 'digest', label: 'Digest', icon: Mail },
];

export function KeywordTrackerPanel() {
    const status = useSearchConsoleStatus();
    const isConnected = status.data?.connected;

    if (status.isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-slate-400 dark:text-slate-500 animate-spin" />
            </div>
        );
    }

    if (!isConnected) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-6">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500/20 to-violet-500/20 dark:from-blue-500/10 dark:to-violet-500/10 rounded-3xl flex items-center justify-center mb-6 animate-float">
                    <Search className="w-10 h-10 text-blue-500 dark:text-blue-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Connect Search Console First</h3>
                <p className="text-slate-500 dark:text-slate-400 text-center max-w-md">
                    To track keyword rankings, connect your Google Search Console on the SEO Overview tab.
                </p>
            </div>
        );
    }

    return <TrackerContent />;
}

function TrackerContent() {
    const { data, isLoading } = useTrackedKeywords();
    const addKeyword = useAddKeyword();
    const deleteKeyword = useDeleteKeyword();
    const refreshKeywords = useRefreshKeywords();
    const bulkImport = useBulkImportKeywords();

    const [activeSubTab, setActiveSubTab] = useState<TrackerSubTab>('keywords');
    const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null);
    const [newKeyword, setNewKeyword] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [showBulkImport, setShowBulkImport] = useState(false);
    const [bulkText, setBulkText] = useState('');

    const keywords = data?.keywords || [];

    const handleAdd = async () => {
        const trimmed = newKeyword.trim();
        if (!trimmed) return;
        setAddError(null);
        try {
            await addKeyword.mutateAsync({ keyword: trimmed });
            setNewKeyword('');
            setShowAddForm(false);
        } catch (err: any) {
            setAddError(err?.message || 'Failed to add keyword');
        }
    };

    const handleDelete = async (id: string, keyword: string) => {
        if (!window.confirm(`Remove "${keyword}" from tracking?`)) return;
        if (selectedKeywordId === id) setSelectedKeywordId(null);
        await deleteKeyword.mutateAsync(id);
    };

    const handleBulkImport = async () => {
        const kws = bulkText.split('\n').map(k => k.trim()).filter(Boolean);
        if (kws.length === 0) return;
        await bulkImport.mutateAsync({ keywords: kws });
        setBulkText('');
        setShowBulkImport(false);
    };

    return (
        <div className="space-y-6">
            {/* Sub-Tab Navigation */}
            <div className="flex items-center justify-between">
                <div className="flex bg-slate-100/80 dark:bg-slate-800/60 backdrop-blur-sm p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/40 overflow-x-auto">
                    {SUB_TABS.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeSubTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveSubTab(tab.id)}
                                className={`flex items-center gap-1.5 px-3 py-2 font-medium text-xs rounded-lg transition-all duration-200 whitespace-nowrap ${isActive
                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
                {activeSubTab === 'keywords' && (
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                        <button
                            onClick={() => refreshKeywords.mutate()}
                            disabled={refreshKeywords.isPending}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${refreshKeywords.isPending ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                        <button
                            onClick={() => setShowBulkImport(!showBulkImport)}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200"
                        >
                            <Upload className="w-4 h-4" />
                            Bulk
                        </button>
                        <button
                            onClick={() => setShowAddForm(!showAddForm)}
                            className="btn-gradient btn-shimmer flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl font-semibold"
                        >
                            <Plus className="w-4 h-4" />
                            Track
                        </button>
                    </div>
                )}
            </div>

            {/* Bulk Import Modal */}
            {showBulkImport && activeSubTab === 'keywords' && (
                <div className="glass-panel rounded-xl p-4 space-y-3 animate-fade-slide-up">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Upload className="w-4 h-4 text-slate-400" />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Bulk Import</span>
                        </div>
                        <button onClick={() => { setShowBulkImport(false); setBulkText(''); }} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <textarea
                        value={bulkText}
                        onChange={(e) => setBulkText(e.target.value)}
                        placeholder={"Enter keywords, one per line:\ngold necklace\nsilver bracelet\ndiamond ring"}
                        rows={5}
                        className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 resize-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition-all"
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{bulkText.split('\n').filter(k => k.trim()).length} keywords</span>
                        <button
                            onClick={handleBulkImport}
                            disabled={!bulkText.trim() || bulkImport.isPending}
                            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                        >
                            {bulkImport.isPending ? 'Importing...' : 'Import All'}
                        </button>
                    </div>
                </div>
            )}

            {/* Sub-tab Content */}
            <div key={activeSubTab} className="animate-fade-slide-up">
                {activeSubTab === 'keywords' && (
                    <>
                        {/* Add Keyword Form */}
                        {showAddForm && (
                            <>
                                <div className="glass-panel rounded-xl p-4 flex items-center gap-3 mb-4">
                                    <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                                    <input
                                        type="text"
                                        placeholder="Enter a keyword to track (e.g. gold necklace)"
                                        value={newKeyword}
                                        onChange={(e) => setNewKeyword(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                                        className="input-premium flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleAdd}
                                        disabled={!newKeyword.trim() || addKeyword.isPending}
                                        className="px-4 py-1.5 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium"
                                    >
                                        {addKeyword.isPending ? 'Adding...' : 'Add'}
                                    </button>
                                    <button
                                        onClick={() => { setShowAddForm(false); setNewKeyword(''); setAddError(null); }}
                                        className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                {addError && <p className="text-xs text-red-500 dark:text-red-400 px-1 -mt-2 mb-4">{addError}</p>}
                            </>
                        )}

                        {/* Suggested Keywords */}
                        <SuggestedKeywords
                            trackedKeywords={keywords.map((kw: TrackedKeywordSummary) => kw.keyword.toLowerCase())}
                            onTrack={async (keyword: string) => {
                                try { await addKeyword.mutateAsync({ keyword }); } catch { /* swallow */ }
                            }}
                            isAdding={addKeyword.isPending}
                        />

                        {/* Keyword List + History */}
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
                            <div className="xl:col-span-1 glass-panel rounded-2xl overflow-hidden">
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 className="w-6 h-6 text-slate-400 dark:text-slate-500 animate-spin" />
                                    </div>
                                ) : keywords.length === 0 ? (
                                    <div className="text-center py-14 px-6">
                                        <Search className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3 animate-float" />
                                        <p className="text-sm text-slate-500 dark:text-slate-400">No keywords tracked yet.</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Click "Track" to start monitoring positions.</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                        {keywords.map((kw: TrackedKeywordSummary, i: number) => (
                                            <div
                                                key={kw.id}
                                                className={`animate-fade-slide-up ${i < 8 ? `animation-delay-${i * 100}` : ''}`}
                                                style={i >= 8 ? { animationDelay: `${i * 100}ms` } : undefined}
                                            >
                                                <KeywordRow
                                                    keyword={kw}
                                                    isSelected={selectedKeywordId === kw.id}
                                                    onSelect={() => setSelectedKeywordId(kw.id)}
                                                    onDelete={() => handleDelete(kw.id, kw.keyword)}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="xl:col-span-2">
                                {selectedKeywordId ? (
                                    <KeywordHistoryChart keywordId={selectedKeywordId} />
                                ) : (
                                    <div className="glass-panel rounded-2xl flex items-center justify-center py-24">
                                        <div className="text-center">
                                            <TrendingUp className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3 animate-float" />
                                            <p className="text-sm text-slate-500 dark:text-slate-400">Select a keyword to view position history</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {activeSubTab === 'groups' && <KeywordGroupsTab />}
                {activeSubTab === 'competitors' && <CompetitorTab />}
                {activeSubTab === 'revenue' && <RevenueTab />}
                {activeSubTab === 'health' && <HealthTab />}
                {activeSubTab === 'digest' && <DigestTab />}
            </div>
        </div>
    );
}

/** Single keyword row in the list */
function KeywordRow({ keyword, isSelected, onSelect, onDelete }: {
    keyword: TrackedKeywordSummary;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
}) {
    const pos = keyword.currentPosition;
    const posFormatted = pos ? `#${Math.round(pos)}` : '—';

    return (
        <div
            onClick={onSelect}
            className={`flex items-center justify-between px-4 py-3.5 cursor-pointer transition-all duration-200 border-l-2 ${isSelected
                ? 'bg-blue-50/80 dark:bg-blue-900/20 border-blue-500 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)]'
                : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border-transparent'
                }`}
        >
            <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 dark:text-slate-200 text-sm truncate">{keyword.keyword}</p>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-0.5">
                        Pos: <span className={`font-semibold ${pos && pos <= 10 ? 'text-emerald-600 dark:text-emerald-400' : pos && pos <= 20 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                            {posFormatted}
                        </span>
                    </span>
                    {keyword.currentClicks != null && (
                        <span>{keyword.currentClicks} clicks</span>
                    )}
                    {keyword.currentImpressions != null && (
                        <span>{keyword.currentImpressions.toLocaleString()} imp</span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
                    title="Remove keyword"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className={`w-4 h-4 transition-colors ${isSelected ? 'text-blue-500 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600'}`} />
            </div>
        </div>
    );
}

/**
 * Position history chart for a specific keyword.
 *
 * Uses pure SVG with native <title> tooltips for a lightweight
 * interactive chart that avoids charting library dependencies.
 */
function KeywordHistoryChart({ keywordId }: { keywordId: string }) {
    const [days, setDays] = useState(30);
    const { data, isLoading } = useKeywordHistory(keywordId, days);
    const history = data?.history || [];

    // Compute chart dimensions
    const chartData = useMemo(() => {
        if (history.length < 2) return null;

        const positions = history.map((h: RankHistoryPoint) => h.position);
        const maxPos = Math.max(...positions);
        const minPos = Math.min(...positions);
        const range = maxPos - minPos || 1;

        // SVG viewbox dimensions
        const width = 600;
        const height = 200;
        const padding = 20;
        const chartW = width - padding * 2;
        const chartH = height - padding * 2;

        // Generate path points (inverted Y because lower position = better)
        const points = history.map((h: RankHistoryPoint, i: number) => ({
            x: padding + (i / (history.length - 1)) * chartW,
            y: padding + ((h.position - minPos) / range) * chartH,
            ...h,
        }));

        const pathD = points.map((p: typeof points[0], i: number) =>
            `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
        ).join(' ');

        // Area fill path
        const areaD = pathD + ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

        return { points, pathD, areaD, width, height, minPos, maxPos };
    }, [history]);

    // Trend computation
    const trend = useMemo(() => {
        if (history.length < 2) return null;
        const first = history[0];
        const last = history[history.length - 1];
        const change = first.position - last.position;
        return {
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
            amount: Math.abs(Math.round(change * 10) / 10),
            currentPos: Math.round(last.position * 10) / 10,
            totalClicks: history.reduce((s: number, h: RankHistoryPoint) => s + h.clicks, 0),
            totalImpressions: history.reduce((s: number, h: RankHistoryPoint) => s + h.impressions, 0),
        };
    }, [history]);

    /** Format date string for display */
    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="glass-panel rounded-2xl p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100">Position History</h4>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200/50 dark:border-slate-700/50">
                    {[7, 14, 30, 60].map(d => (
                        <button
                            key={d}
                            onClick={() => setDays(d)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${days === d
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            {d}d
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 text-slate-400 dark:text-slate-500 animate-spin" />
                </div>
            ) : history.length < 2 ? (
                <div className="text-center py-20">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Not enough data yet. Positions refresh daily.</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Check back tomorrow for the first data point.</p>
                </div>
            ) : (
                <>
                    {/* Trend Summary Stats */}
                    {trend && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 rounded-xl p-3.5 border border-blue-100 dark:border-blue-800/30">
                                <p className="text-xs text-blue-600/70 dark:text-blue-400/70 font-medium">Current Position</p>
                                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-0.5">#{trend.currentPos}</p>
                            </div>
                            <div className={`rounded-xl p-3.5 border ${trend.direction === 'up'
                                ? 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-800/10 border-emerald-100 dark:border-emerald-800/30'
                                : trend.direction === 'down'
                                    ? 'bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-900/20 dark:to-rose-800/10 border-rose-100 dark:border-rose-800/30'
                                    : 'bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/40 dark:to-slate-700/20 border-slate-200 dark:border-slate-700/40'
                                }`}>
                                <p className="text-xs font-medium opacity-70">Position Change</p>
                                <div className={`flex items-center gap-1 text-2xl font-bold mt-0.5 ${trend.direction === 'up' ? 'text-emerald-600 dark:text-emerald-400' : trend.direction === 'down' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'
                                    }`}>
                                    {trend.direction === 'up' ? <TrendingUp className="w-5 h-5" /> :
                                        trend.direction === 'down' ? <TrendingDown className="w-5 h-5" /> :
                                            <Minus className="w-5 h-5" />}
                                    {trend.direction === 'up' ? '+' : trend.direction === 'down' ? '-' : ''}{trend.amount}
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-900/20 dark:to-violet-800/10 rounded-xl p-3.5 border border-violet-100 dark:border-violet-800/30">
                                <p className="text-xs text-violet-600/70 dark:text-violet-400/70 font-medium">Total Clicks</p>
                                <p className="text-2xl font-bold text-violet-700 dark:text-violet-300 mt-0.5">{trend.totalClicks.toLocaleString()}</p>
                            </div>
                            <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-900/20 dark:to-amber-800/10 rounded-xl p-3.5 border border-amber-100 dark:border-amber-800/30">
                                <p className="text-xs text-amber-600/70 dark:text-amber-400/70 font-medium">Total Impressions</p>
                                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-0.5">{trend.totalImpressions.toLocaleString()}</p>
                            </div>
                        </div>
                    )}

                    {/* SVG Chart */}
                    {chartData && (
                        <div className="relative">
                            <svg viewBox={`0 0 ${chartData.width} ${chartData.height}`} className="w-full h-52">
                                {/* Grid lines */}
                                {[0.25, 0.5, 0.75].map(pct => {
                                    const y = 20 + pct * 160;
                                    return <line key={pct} x1="20" y1={y} x2="580" y2={y} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="4 4" />;
                                })}
                                {/* Area fill */}
                                <path d={chartData.areaD} fill="url(#posGradient)" opacity="0.25" />
                                {/* Position line */}
                                <path d={chartData.pathD} fill="none" stroke="url(#lineGradient)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                                {/* Data points with native tooltips */}
                                {chartData.points.map((p: typeof chartData.points[0], i: number) => (
                                    <circle
                                        key={i}
                                        cx={p.x}
                                        cy={p.y}
                                        r="4"
                                        fill="white"
                                        className="dark:fill-slate-800"
                                        stroke="url(#lineGradient)"
                                        strokeWidth="2"
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <title>{`${formatDate(p.date)}: Position #${Math.round(p.position * 10) / 10}\n${p.clicks} clicks · ${p.impressions.toLocaleString()} impressions`}</title>
                                    </circle>
                                ))}
                                <defs>
                                    <linearGradient id="posGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b82f6" />
                                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                                    </linearGradient>
                                    <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="#3b82f6" />
                                        <stop offset="100%" stopColor="#8b5cf6" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            {/* Y-axis labels */}
                            <div className="absolute top-0 left-0 h-full flex flex-col justify-between py-3 text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                <span>#{Math.round(chartData.minPos)}</span>
                                <span>#{Math.round(chartData.maxPos)}</span>
                            </div>
                            {/* X-axis labels */}
                            <div className="flex justify-between mt-1.5 text-[10px] text-slate-400 dark:text-slate-500 font-mono px-5">
                                <span>{formatDate(history[0].date)}</span>
                                {history.length > 4 && (
                                    <span>{formatDate(history[Math.floor(history.length / 2)].date)}</span>
                                )}
                                <span>{formatDate(history[history.length - 1].date)}</span>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * SuggestedKeywords — surfaces keywords from low-hanging fruit + AI
 * recommendations that the user isn't tracking yet.
 *
 * Why dedup + filter: avoids showing duplicates across data sources
 * and hides keywords the user is already monitoring.
 */
function SuggestedKeywords({ trackedKeywords, onTrack, isAdding }: {
    trackedKeywords: string[];
    onTrack: (keyword: string) => void;
    isAdding: boolean;
}) {
    const { data, isLoading } = useKeywordRecommendations();
    const [trackingKw, setTrackingKw] = useState<string | null>(null);

    const suggestions = useMemo(() => {
        if (!data) return [];

        const seen = new Set<string>(trackedKeywords);
        const result: { keyword: string; source: string }[] = [];

        // Low-hanging fruit queries — highest value
        for (const item of data.lowHangingFruit || []) {
            const kw = item.query.toLowerCase().trim();
            if (!seen.has(kw)) {
                seen.add(kw);
                result.push({ keyword: item.query, source: 'low-hanging' });
            }
        }

        // AI recommendation keywords
        for (const rec of data.aiRecommendations || []) {
            for (const kw of rec.keywords) {
                const normalized = kw.toLowerCase().trim();
                if (!seen.has(normalized)) {
                    seen.add(normalized);
                    result.push({ keyword: kw, source: 'ai' });
                }
            }
        }

        return result.slice(0, 15);
    }, [data, trackedKeywords]);

    if (isLoading || suggestions.length === 0) return null;

    const handleTrack = async (keyword: string) => {
        setTrackingKw(keyword);
        await onTrack(keyword);
        setTrackingKw(null);
    };

    return (
        <div className="glass-panel rounded-xl p-4 animate-fade-slide-up">
            <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Suggested Keywords</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">— click to start tracking</span>
            </div>
            <div className="flex flex-wrap gap-2">
                {suggestions.map(({ keyword, source }) => (
                    <button
                        key={keyword}
                        onClick={() => handleTrack(keyword)}
                        disabled={isAdding}
                        className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 disabled:opacity-50 ${trackingKw === keyword
                            ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400'
                            : source === 'low-hanging'
                                ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200/60 dark:border-amber-800/30 text-slate-700 dark:text-slate-300 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                : 'bg-violet-50/50 dark:bg-violet-900/10 border-violet-200/60 dark:border-violet-800/30 text-slate-700 dark:text-slate-300 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20'
                            }`}
                    >
                        {trackingKw === keyword ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <Plus className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity" />
                        )}
                        {keyword}
                    </button>
                ))}
            </div>
        </div>
    );
}
