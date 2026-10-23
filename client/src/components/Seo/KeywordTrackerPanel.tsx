/**
 * KeywordTrackerPanel — SEO command center with sub-tabbed interface.
 *
 * Sub-tabs: Keywords (list+chart), Groups, Competitors, Revenue, Health, Digest.
 * Also includes bulk import functionality.
 */

import { useState, useMemo, useId } from 'react';
import { Metric, MetricStrip } from '../ui/MetricStrip';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';
import {
    Plus, Trash2, RefreshCw, TrendingUp,
    Loader2, Search, ChevronRight, X, Sparkles,
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

export function KeywordTrackerPanel({ siteUrl }: { siteUrl?: string }) {
    const { user, token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Sign in and select an account to track keywords.</p>;
    return <ScopedTracker key={JSON.stringify([user?.id, token, currentAccount.id, siteUrl])} siteUrl={siteUrl} />;
}
function ScopedTracker({ siteUrl }: { siteUrl?: string }) {
    const status = useSearchConsoleStatus();
    const isConnected = status.data?.connected;
    const hasAuthError = status.data?.authError;

    if (status.isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-slate-400 dark:text-slate-500 animate-spin" />
            </div>
        );
    }
    if (status.error) return <p role="alert">Search Console status unavailable. <button type="button" onClick={() => void status.refetch()}>Retry status</button></p>;

    if (hasAuthError) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-6">
                <div className="w-20 h-20 bg-amber-500/20     rounded-xl flex items-center justify-center mb-6">
                    <Search className="w-10 h-10 text-amber-500 dark:text-amber-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Search Console Disconnected</h3>
                <p className="text-slate-500 dark:text-slate-400 text-center max-w-md">
                    Your Google Search Console access has expired. Reconnect on the SEO Overview tab to resume keyword tracking.
                </p>
            </div>
        );
    }

    if (!isConnected) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-6">
                <div className="w-20 h-20 bg-[var(--brand-subtle)] rounded-xl flex items-center justify-center mb-6 ">
                    <Search className="w-10 h-10 text-[var(--brand-text)]" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Connect Search Console First</h3>
                <p className="text-slate-500 dark:text-slate-400 text-center max-w-md">
                    To track keyword rankings, connect your Google Search Console on the SEO Overview tab.
                </p>
            </div>
        );
    }

    return <TrackerContent siteUrl={siteUrl} />;
}

function TrackerContent({ siteUrl }: { siteUrl?: string }) {
    const { data, isLoading, error: readError, refetch } = useTrackedKeywords();
    const { run, busy, error } = useScopedMutation();
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
        if (!trimmed || trimmed.length > 200) { setAddError('Enter a keyword of 1–200 characters.'); return; }
        setAddError(null);
        const result = await run(() => addKeyword.mutateAsync({ keyword: trimmed }), 'Could not add keyword. Please retry.');
        if (result.ok) {
            setNewKeyword('');
            setShowAddForm(false);
        }
    };

    const handleDelete = async (id: string, keyword: string) => {
        if (!window.confirm(`Remove "${keyword}" from tracking?`)) return;
        const result = await run(() => deleteKeyword.mutateAsync(id), 'Could not delete keyword. Please retry.');
        if (result.ok) setSelectedKeywordId(current => current === id ? null : current);
    };

    const handleBulkImport = async () => {
        const kws = [...new Set(bulkText.split('\n').map(k => k.trim().toLowerCase()).filter(Boolean))];
        if (kws.length === 0 || kws.length > 500 || kws.some(keyword => keyword.length > 200)) { setAddError('Import 1–500 unique keywords, each at most 200 characters.'); return; }
        setAddError(null);
        const result = await run(async () => {
            const value = await bulkImport.mutateAsync({ keywords: kws });
            if (!isRecord(value) || value.failed !== 0 || typeof value.added !== 'number' || !Number.isSafeInteger(value.added) || value.added < 0 || typeof value.skipped !== 'number' || !Number.isSafeInteger(value.skipped) || value.skipped < 0 || value.added + value.skipped !== kws.length) throw new Error('Incomplete keyword import');
            return value;
        }, 'Import did not complete successfully. Your text is retained; already imported keywords are deduplicated by the server.');
        if (result.ok) { setBulkText(''); setShowBulkImport(false); }
    };

    return (
        <div className="space-y-6">
            <p className="text-sm text-slate-500 dark:text-slate-400">Tracked keywords, history, refreshes and management tabs are account-wide. {siteUrl ? `Suggestions use ${siteUrl}.` : 'No site-specific suggestions selected.'}</p>
            {(error || addError) && <p role="alert">{error || addError}</p>}
            {readError && <p role="alert">Tracked keywords unavailable. <button type="button" onClick={() => void refetch()}>Retry tracked keywords</button></p>}
            {/* Sub-Tab Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex bg-slate-100/80 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/40 overflow-x-auto">
                    {SUB_TABS.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeSubTab === tab.id;
                        return (
                            <button
                                type="button"
                                aria-pressed={isActive}
                                key={tab.id}
                                onClick={() => setActiveSubTab(tab.id)}
                                className={`flex items-center gap-1.5 px-3 py-2 font-medium text-xs rounded-lg transition-all duration-200 whitespace-nowrap ${isActive
                                        ? 'bg-[var(--brand-subtle)] text-[var(--brand-text)]'
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
                            type="button"
                            onClick={() => void run(async () => { const value = await refreshKeywords.mutateAsync(); if (!isRecord(value) || value.success !== true) throw new Error('Refresh not acknowledged'); }, 'Could not refresh account keywords. Please retry.')}
                            disabled={busy}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${refreshKeywords.isPending ? 'animate-spin' : ''}`} />
                            Refresh account keywords
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setShowBulkImport(!showBulkImport)}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200"
                        >
                            <Upload className="w-4 h-4" />
                            Bulk
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setShowAddForm(!showAddForm)}
                            className="bg-[var(--primary-color)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl font-semibold"
                        >
                            <Plus className="w-4 h-4" />
                            Track
                        </button>
                    </div>
                )}
            </div>

            {/* Bulk Import Modal */}
            {showBulkImport && activeSubTab === 'keywords' && (
                <div className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl p-4 space-y-3 animate-fade-slide-up">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Upload className="w-4 h-4 text-slate-400" />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Bulk Import</span>
                        </div>
                        <button type="button" aria-label="Close keyword import" disabled={busy} onClick={() => { setShowBulkImport(false); setBulkText(''); }} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <textarea
                        disabled={busy}
                        aria-label="Keywords to import, one per line"
                        maxLength={101000}
                        value={bulkText}
                        onChange={(e) => setBulkText(e.target.value)}
                        placeholder={"Enter keywords, one per line:\ngold necklace\nsilver bracelet\ndiamond ring"}
                        rows={5}
                        className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 resize-none focus:ring-2 focus:ring-[var(--focus-color)] focus:border-[var(--primary-color)] outline-none transition-all"
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{bulkText.split('\n').filter(k => k.trim()).length} keywords</span>
                        <button
                            type="button"
                            onClick={handleBulkImport}
                            disabled={!bulkText.trim() || busy}
                            className="px-4 py-1.5 text-sm bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors font-medium"
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
                                <div className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl p-4 flex items-center gap-3 mb-4">
                                    <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                                    <input
                                        disabled={busy}
                                        type="text"
                                        aria-label="Keyword to track"
                                        maxLength={200}
                                        placeholder="Enter a keyword to track (e.g. gold necklace)"
                                        value={newKeyword}
                                        onChange={(e) => setNewKeyword(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd(); } }}
                                        className="input-premium flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAdd}
                                        disabled={!newKeyword.trim() || busy}
                                        className="px-4 py-1.5 text-sm bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors font-medium"
                                    >
                                        {addKeyword.isPending ? 'Adding...' : 'Add'}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Close add keyword"
                                        disabled={busy}
                                        onClick={() => { setShowAddForm(false); setNewKeyword(''); setAddError(null); }}
                                        className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Suggested Keywords */}
                        <SuggestedKeywords
                            trackedKeywords={keywords.map((kw: TrackedKeywordSummary) => kw.keyword.toLowerCase())}
                            siteUrl={siteUrl}
                            onTrack={async (keyword: string) => { await run(() => addKeyword.mutateAsync({ keyword }), 'Could not track suggested keyword. Please retry.'); }}
                            isAdding={busy}
                        />

                        {/* Keyword List + History */}
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
                            <div className="xl:col-span-1 border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl overflow-hidden">
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 className="w-6 h-6 text-slate-400 dark:text-slate-500 animate-spin" />
                                    </div>
                                ) : readError ? <p role="alert" className="p-4">Keyword list unavailable.</p> : keywords.length === 0 ? (
                                    <div className="text-center py-14 px-6">
                                        <Search className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3 " />
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
                                                    disabled={busy}
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
                                    <div className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl flex items-center justify-center py-24">
                                        <div className="text-center">
                                            <TrendingUp className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3 " />
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
function KeywordRow({ keyword, isSelected, onSelect, onDelete, disabled }: {
    keyword: TrackedKeywordSummary;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
    disabled: boolean;
}) {
    const pos = keyword.currentPosition;
    const posFormatted = pos ? `#${Math.round(pos)}` : '—';

    return (
        <div
            className={`flex items-center justify-between px-4 py-3.5 cursor-pointer transition-all duration-200 border-l-2 ${isSelected
                ? 'bg-[var(--brand-subtle)] border-[var(--primary-color)] '
                : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border-transparent'
                }`}
        >
            <button type="button" onClick={onSelect} aria-pressed={isSelected} className="flex-1 min-w-0 text-left">
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
            </button>
            <div className="flex items-center gap-1 shrink-0">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
                    title="Remove keyword"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className={`w-4 h-4 transition-colors ${isSelected ? 'text-[var(--brand-text)]' : 'text-slate-300 dark:text-slate-600'}`} />
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
    const gradientId = useId();
    const [days, setDays] = useState(30);
    const { data, isLoading, error, refetch } = useKeywordHistory(keywordId, days);
    const history = useMemo(() => data?.history ?? [], [data?.history]);

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
        const start = Date.parse(history[0].date); const duration = Date.parse(history[history.length - 1].date) - start;
        const points = history.map((h: RankHistoryPoint) => ({
            x: padding + ((Date.parse(h.date) - start) / duration) * chartW,
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
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    };

    return (
        <div className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100">Position History</h4>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200/50 dark:border-slate-700/50">
                    {[7, 14, 30, 60].map(d => (
                        <button
                            type="button"
                            aria-pressed={days === d}
                            key={d}
                            onClick={() => setDays(d)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${days === d
                                ? 'bg-[var(--brand-subtle)] text-[var(--brand-text)]'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            {d}d
                        </button>
                    ))}
                </div>
            </div>

            {error ? <p role="alert">Position history unavailable. <button type="button" onClick={() => void refetch()}>Retry history</button></p> : isLoading ? (
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
                        <MetricStrip label="Keyword trend summary" className="mb-6">
                            <Metric label="Current Position" value={`#${trend.currentPos}`} />
                            <Metric label="Position Change" value={`${trend.direction === 'up' ? '+' : trend.direction === 'down' ? '-' : ''}${trend.amount}`} hint={trend.direction === 'up' ? 'Improved' : trend.direction === 'down' ? 'Declined' : 'Unchanged'} valueClassName={trend.direction === 'up' ? 'text-emerald-600 dark:text-emerald-400' : trend.direction === 'down' ? 'text-rose-600 dark:text-rose-400' : undefined} />
                            <Metric label="Total Clicks" value={trend.totalClicks.toLocaleString()} />
                            <Metric label="Total Impressions" value={trend.totalImpressions.toLocaleString()} />
                        </MetricStrip>
                    )}

                    {/* SVG Chart */}
                    {chartData && (
                        <div className="relative">
                            <svg role="img" aria-label={`Observed keyword position over ${days} days; lower positions are better`} viewBox={`0 0 ${chartData.width} ${chartData.height}`} className="w-full h-52">
                                {/* Grid lines */}
                                {[0.25, 0.5, 0.75].map(pct => {
                                    const y = 20 + pct * 160;
                                    return <line key={pct} x1="20" y1={y} x2="580" y2={y} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="4 4" />;
                                })}
                                {/* Area fill */}
                                <path d={chartData.areaD} fill={`url(#${gradientId}-area)`} opacity="0.25" />
                                {/* Position line */}
                                <path d={chartData.pathD} fill="none" stroke={`url(#${gradientId}-line)`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                                {/* Data points with native tooltips */}
                                {chartData.points.map((p: typeof chartData.points[0], i: number) => (
                                    <circle
                                        key={i}
                                        cx={p.x}
                                        cy={p.y}
                                        r="4"
                                        fill="white"
                                        className="dark:fill-slate-800"
                                        stroke={`url(#${gradientId}-line)`}
                                        strokeWidth="2"
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <title>{`${formatDate(p.date)}: Position #${Math.round(p.position * 10) / 10}\n${p.clicks} clicks · ${p.impressions.toLocaleString()} impressions`}</title>
                                    </circle>
                                ))}
                                <defs>
                                    <linearGradient id={`${gradientId}-area`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b82f6" />
                                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                                    </linearGradient>
                                    <linearGradient id={`${gradientId}-line`} x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="#3b82f6" />
                                        <stop offset="100%" stopColor="#8b5cf6" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            <details><summary>Observation data (UTC dates)</summary><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>Date</th><th>Position</th><th>Clicks</th><th>Impressions</th></tr></thead><tbody>{history.map(point => <tr key={point.date}><td>{point.date.slice(0, 10)}</td><td>{point.position}</td><td>{point.clicks}</td><td>{point.impressions}</td></tr>)}</tbody></table></div></details>
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
function SuggestedKeywords({ trackedKeywords, onTrack, isAdding, siteUrl }: {
    trackedKeywords: string[];
    onTrack: (keyword: string) => void;
    isAdding: boolean;
    siteUrl?: string;
}) {
    const { data, isLoading, error, refetch } = useKeywordRecommendations(siteUrl);
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

    if (error) return <p role="alert">Suggestions unavailable. <button type="button" onClick={() => void refetch()}>Retry suggestions</button></p>;
    if (isLoading) return null;
    if (!suggestions.length) return data?.warnings?.length ? <p role="status">Some recommendation sources are unavailable. Empty suggestions do not establish that no opportunities exist.</p> : null;

    const handleTrack = async (keyword: string) => {
        setTrackingKw(keyword);
        try {
            await onTrack(keyword);
        } finally {
            setTrackingKw(null);
        }
    };

    return (
        <div className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl p-4 animate-fade-slide-up">
            <p className="text-xs text-slate-500">Candidate ideas from returned query samples, not proof of missing visibility. {data?.warnings?.join('; ')}</p>
            <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-[var(--brand-text)]" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Suggested Keywords</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">— click to start tracking</span>
            </div>
            <div className="flex flex-wrap gap-2">
                {suggestions.map(({ keyword, source }) => (
                    <button
                        type="button"
                        key={keyword}
                        onClick={() => handleTrack(keyword)}
                        disabled={isAdding || trackingKw !== null}
                        className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 disabled:opacity-50 ${trackingKw === keyword
                            ? 'bg-[var(--brand-subtle)] border-[var(--brand-border)] text-[var(--brand-text)]'
                            : source === 'low-hanging'
                                ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200/60 dark:border-amber-800/30 text-slate-700 dark:text-slate-300 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                : 'bg-[var(--brand-subtle)] border-[var(--brand-border)] text-slate-700 dark:text-slate-300 hover:border-[var(--brand-border)] dark:hover:border-[var(--brand-border)] hover:bg-[var(--brand-subtle)] dark:hover:bg-[var(--brand-subtle)]'
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
