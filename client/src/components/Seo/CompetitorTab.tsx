/**
 * Competitor Intelligence Tab
 *
 * Full competitor SEO tracking dashboard with:
 * - Competitor domain management (add/remove)
 * - SERP position tracking table per competitor
 * - Movement feed showing recent significant rank changes
 * - Head-to-head comparison (your position vs theirs)
 * - Manual refresh trigger for SERP checks
 *
 * Why one component: keeps all competitor intelligence in a single
 * tab view. Sub-sections are collapsible to avoid overwhelming the user.
 */

import { useState } from 'react';
import {
    useCompetitors,
    useAddCompetitor,
    useRemoveCompetitor,
    useCompetitorKeywords,
    useCompetitorMovement,
    useCompetitorHeadToHead,
    useRefreshCompetitorPositions,
    type CompetitorDomain,
    type CompetitorKeywordPosition,
    type CompetitorMovement,
    type HeadToHeadRow,
} from '../../hooks/useSeoKeywords';

/** Format a SERP position for display */
function formatPosition(pos: number | null): string {
    if (pos === null) return '—';
    return `#${Math.round(pos)}`;
}

/** Get color class for a position value */
function positionColorClass(pos: number | null): string {
    if (pos === null) return 'text-slate-400';
    if (pos <= 3) return 'text-emerald-500';
    if (pos <= 10) return 'text-sky-500';
    if (pos <= 20) return 'text-amber-500';
    return 'text-red-400';
}

/** Get color class for a position change */
function changeColorClass(change: number | null): string {
    if (change === null) return 'text-slate-400';
    if (change > 0) return 'text-emerald-500';
    if (change < 0) return 'text-red-400';
    return 'text-slate-400';
}

/** Direction icon for movement events */
function directionIcon(dir: CompetitorMovement['direction']): string {
    switch (dir) {
        case 'improved': return '🔺';
        case 'declined': return '🔻';
        case 'entered': return '🆕';
        case 'dropped': return '❌';
    }
}

export function CompetitorTab() {
    const [newDomain, setNewDomain] = useState('');
    const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);
    const [activeView, setActiveView] = useState<'positions' | 'movement' | 'headtohead'>('positions');

    const { data: competitorsData, isLoading: competitorsLoading } = useCompetitors();
    const addCompetitor = useAddCompetitor();
    const removeCompetitor = useRemoveCompetitor();
    const refreshPositions = useRefreshCompetitorPositions();

    const competitors = competitorsData?.competitors ?? [];
    const selectedCompetitor = competitors.find(c => c.id === selectedCompetitorId) ?? null;

    const { data: keywordsData, isLoading: keywordsLoading } = useCompetitorKeywords(selectedCompetitorId);
    const { data: movementData, isLoading: movementLoading } = useCompetitorMovement(7);
    const { data: headToHeadData, isLoading: h2hLoading } = useCompetitorHeadToHead(selectedCompetitor?.domain ?? null);

    const keywords = keywordsData?.keywords ?? [];
    const movements = movementData?.movements ?? [];
    const headToHead = headToHeadData?.rows ?? [];

    /** Handle adding a competitor */
    const handleAdd = () => {
        const domain = newDomain.trim();
        if (!domain) return;
        addCompetitor.mutate({ domain }, {
            onSuccess: () => setNewDomain(''),
        });
    };

    return (
        <div className="space-y-6">
            {/* ── Header: Add Competitor + Refresh ── */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 flex gap-2">
                    <input
                        id="competitor-domain-input"
                        type="text"
                        placeholder="competitor.com"
                        value={newDomain}
                        onChange={e => setNewDomain(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    />
                    <button
                        id="add-competitor-btn"
                        onClick={handleAdd}
                        disabled={addCompetitor.isPending || !newDomain.trim()}
                        className="px-4 py-2 rounded-lg bg-sky-500/20 text-sky-400 text-sm font-medium hover:bg-sky-500/30 transition-colors disabled:opacity-50"
                    >
                        {addCompetitor.isPending ? 'Adding…' : 'Add'}
                    </button>
                </div>
                <button
                    id="refresh-competitor-positions-btn"
                    onClick={() => refreshPositions.mutate()}
                    disabled={refreshPositions.isPending || competitors.length === 0}
                    className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                >
                    {refreshPositions.isPending ? 'Checking SERPs…' : '🔄 Refresh Positions'}
                </button>
            </div>

            {/* ── Competitor Cards ── */}
            {competitorsLoading ? (
                <div className="text-sm text-slate-400 text-center py-6">Loading competitors…</div>
            ) : competitors.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                    <p className="text-lg mb-1">No competitors tracked yet</p>
                    <p className="text-sm">Add a competitor domain above to start tracking their SERP positions.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {competitors.map(comp => (
                        <CompetitorCard
                            key={comp.id}
                            competitor={comp}
                            isSelected={comp.id === selectedCompetitorId}
                            onSelect={() => setSelectedCompetitorId(comp.id === selectedCompetitorId ? null : comp.id)}
                            onRemove={() => {
                                removeCompetitor.mutate(comp.id);
                                if (selectedCompetitorId === comp.id) setSelectedCompetitorId(null);
                            }}
                        />
                    ))}
                </div>
            )}

            {/* ── View Tabs ── */}
            {competitors.length > 0 && (
                <div className="flex gap-1 bg-white/5 rounded-lg p-1">
                    {(['positions', 'movement', 'headtohead'] as const).map(view => (
                        <button
                            key={view}
                            onClick={() => setActiveView(view)}
                            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeView === view
                                ? 'bg-sky-500/20 text-sky-400'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {view === 'positions' && '📊 Positions'}
                            {view === 'movement' && '📈 Movement Feed'}
                            {view === 'headtohead' && '⚔️ Head-to-Head'}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Position Table ── */}
            {activeView === 'positions' && selectedCompetitorId && (
                <PositionTable keywords={keywords} loading={keywordsLoading} competitor={selectedCompetitor} />
            )}
            {activeView === 'positions' && !selectedCompetitorId && competitors.length > 0 && (
                <p className="text-sm text-slate-400 text-center py-6">Select a competitor above to view their keyword positions.</p>
            )}

            {/* ── Movement Feed ── */}
            {activeView === 'movement' && (
                <MovementFeed movements={movements} loading={movementLoading} />
            )}

            {/* ── Head-to-Head ── */}
            {activeView === 'headtohead' && selectedCompetitorId && (
                <HeadToHeadTable rows={headToHead} loading={h2hLoading} competitor={selectedCompetitor} />
            )}
            {activeView === 'headtohead' && !selectedCompetitorId && competitors.length > 0 && (
                <p className="text-sm text-slate-400 text-center py-6">Select a competitor above to see head-to-head comparison.</p>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────

/** Competitor domain card with aggregate stats */
function CompetitorCard({
    competitor,
    isSelected,
    onSelect,
    onRemove,
}: {
    competitor: CompetitorDomain;
    isSelected: boolean;
    onSelect: () => void;
    onRemove: () => void;
}) {
    return (
        <div
            onClick={onSelect}
            className={`relative p-4 rounded-xl border cursor-pointer transition-all ${isSelected
                ? 'border-sky-500/50 bg-sky-500/10 shadow-lg shadow-sky-500/5'
                : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
                }`}
        >
            <button
                onClick={e => { e.stopPropagation(); onRemove(); }}
                className="absolute top-2 right-2 p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Remove competitor"
            >
                ✕
            </button>

            <h4 className="text-sm font-semibold text-white truncate pr-6">{competitor.domain}</h4>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                    <span className="text-slate-400">Keywords</span>
                    <p className="text-white font-medium">{competitor.keywordCount}</p>
                </div>
                <div>
                    <span className="text-slate-400">Avg Position</span>
                    <p className={`font-medium ${positionColorClass(competitor.avgPosition)}`}>
                        {competitor.avgPosition ? `#${competitor.avgPosition}` : '—'}
                    </p>
                </div>
            </div>

            {competitor.lastCheckedAt && (
                <p className="mt-2 text-xs text-slate-500">
                    Last checked: {new Date(competitor.lastCheckedAt).toLocaleDateString()}
                </p>
            )}
        </div>
    );
}

/** Position tracking table for a selected competitor */
function PositionTable({
    keywords,
    loading,
    competitor,
}: {
    keywords: CompetitorKeywordPosition[];
    loading: boolean;
    competitor: CompetitorDomain | null;
}) {
    if (loading) {
        return <div className="text-sm text-slate-400 text-center py-6">Loading positions…</div>;
    }

    if (keywords.length === 0) {
        return (
            <div className="text-center py-6 text-slate-400">
                <p className="text-sm">No keyword data yet.</p>
                <p className="text-xs mt-1">Make sure you're tracking keywords first, then click "Refresh Positions".</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <h4 className="text-sm font-medium text-slate-300 mb-3">
                Positions for <span className="text-sky-400">{competitor?.domain}</span>
            </h4>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-white/10">
                        <th className="pb-2 pr-4">Keyword</th>
                        <th className="pb-2 pr-4 text-right">Position</th>
                        <th className="pb-2 pr-4 text-right">Change</th>
                        <th className="pb-2 text-right">Ranking URL</th>
                    </tr>
                </thead>
                <tbody>
                    {keywords.map(kw => (
                        <tr key={kw.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                            <td className="py-2.5 pr-4 text-white font-medium">{kw.keyword}</td>
                            <td className={`py-2.5 pr-4 text-right font-mono ${positionColorClass(kw.currentPosition)}`}>
                                {formatPosition(kw.currentPosition)}
                            </td>
                            <td className={`py-2.5 pr-4 text-right font-mono ${changeColorClass(kw.positionChange)}`}>
                                {kw.positionChange !== null
                                    ? `${kw.positionChange > 0 ? '+' : ''}${kw.positionChange}`
                                    : '—'
                                }
                            </td>
                            <td className="py-2.5 text-right text-xs text-slate-400 max-w-[200px] truncate" title={kw.rankingUrl ?? ''}>
                                {kw.rankingUrl ? new URL(kw.rankingUrl).pathname : '—'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Movement feed showing recent significant competitor rank changes */
function MovementFeed({
    movements,
    loading,
}: {
    movements: CompetitorMovement[];
    loading: boolean;
}) {
    if (loading) {
        return <div className="text-sm text-slate-400 text-center py-6">Loading movement data…</div>;
    }

    if (movements.length === 0) {
        return (
            <div className="text-center py-6 text-slate-400">
                <p className="text-sm">No significant movements in the last 7 days.</p>
                <p className="text-xs mt-1">Position changes ≥5 places will appear here.</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Recent Movement (last 7 days)</h4>
            {movements.map((m, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                    <span className="text-lg">{directionIcon(m.direction)}</span>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">
                            <span className="text-sky-400 font-medium">{m.competitorDomain}</span>
                            {' '}
                            <span className="text-slate-400">
                                {m.direction === 'entered' && `appeared at ${formatPosition(m.newPosition)} for`}
                                {m.direction === 'dropped' && `dropped out of top 30 for`}
                                {m.direction === 'improved' && `moved ${formatPosition(m.previousPosition)} → ${formatPosition(m.newPosition)} for`}
                                {m.direction === 'declined' && `fell ${formatPosition(m.previousPosition)} → ${formatPosition(m.newPosition)} for`}
                            </span>
                            {' '}
                            <span className="font-medium">"{m.keyword}"</span>
                        </p>
                    </div>
                    <span className="text-xs text-slate-500 shrink-0">{m.date}</span>
                </div>
            ))}
        </div>
    );
}

/** Head-to-head comparison table */
function HeadToHeadTable({
    rows,
    loading,
    competitor,
}: {
    rows: HeadToHeadRow[];
    loading: boolean;
    competitor: CompetitorDomain | null;
}) {
    if (loading) {
        return <div className="text-sm text-slate-400 text-center py-6">Loading comparison…</div>;
    }

    if (rows.length === 0) {
        return (
            <div className="text-center py-6 text-slate-400">
                <p className="text-sm">No shared keywords to compare.</p>
                <p className="text-xs mt-1">Both you and your competitor need keyword data for comparison.</p>
            </div>
        );
    }

    const youWinning = rows.filter(r => r.advantage !== null && r.advantage > 0).length;
    const theyWinning = rows.filter(r => r.advantage !== null && r.advantage < 0).length;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-300">
                    You vs <span className="text-sky-400">{competitor?.domain}</span>
                </h4>
                <div className="flex gap-3 text-xs">
                    <span className="text-emerald-400">You lead: {youWinning}</span>
                    <span className="text-red-400">They lead: {theyWinning}</span>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-slate-400 border-b border-white/10">
                            <th className="pb-2 pr-4">Keyword</th>
                            <th className="pb-2 pr-4 text-right">Your Position</th>
                            <th className="pb-2 pr-4 text-right">Their Position</th>
                            <th className="pb-2 text-right">Advantage</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                <td className="py-2.5 pr-4 text-white font-medium">{row.keyword}</td>
                                <td className={`py-2.5 pr-4 text-right font-mono ${positionColorClass(row.yourPosition)}`}>
                                    {formatPosition(row.yourPosition)}
                                </td>
                                <td className={`py-2.5 pr-4 text-right font-mono ${positionColorClass(row.theirPosition)}`}>
                                    {formatPosition(row.theirPosition)}
                                </td>
                                <td className={`py-2.5 text-right font-mono font-medium ${row.advantage === null ? 'text-slate-400' :
                                    row.advantage > 0 ? 'text-emerald-400' :
                                        row.advantage < 0 ? 'text-red-400' : 'text-slate-400'
                                    }`}>
                                    {row.advantage !== null
                                        ? `${row.advantage > 0 ? '+' : ''}${row.advantage}`
                                        : '—'
                                    }
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
