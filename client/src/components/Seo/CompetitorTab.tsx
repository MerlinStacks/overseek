/**
 * CompetitorTab — Manage competitor domains and view gap analysis.
 *
 * Shows a list of tracked competitors, an add-domain form,
 * and a gap analysis comparison panel.
 */

import { useState } from 'react';
import {
    Users, Plus, Trash2, Loader2, X, BarChart3, Globe
} from 'lucide-react';
import {
    useCompetitors,
    useAddCompetitor,
    useRemoveCompetitor,
    useCompetitorAnalysis,
} from '../../hooks/useSeoKeywords';
import type { CompetitorDomain } from '../../hooks/useSeoKeywords';

export function CompetitorTab() {
    const { data: competitorsData, isLoading } = useCompetitors();
    const addCompetitor = useAddCompetitor();
    const removeCompetitor = useRemoveCompetitor();

    const [showAdd, setShowAdd] = useState(false);
    const [newDomain, setNewDomain] = useState('');
    const [addError, setAddError] = useState<string | null>(null);
    const [analyzeDomain, setAnalyzeDomain] = useState<string | undefined>();

    const competitors = competitorsData?.competitors || [];
    const { data: analysis, isLoading: analysisLoading } = useCompetitorAnalysis(analyzeDomain);

    const handleAdd = async () => {
        const d = newDomain.trim();
        if (!d) return;
        setAddError(null);
        try {
            await addCompetitor.mutateAsync({ domain: d });
            setNewDomain('');
            setShowAdd(false);
        } catch (err: any) {
            setAddError(err?.message || 'Failed to add competitor');
        }
    };

    return (
        <div className="space-y-6 animate-fade-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Competitor Analysis</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Compare your keyword coverage against competitors
                    </p>
                </div>
                <button
                    onClick={() => setShowAdd(!showAdd)}
                    className="btn-gradient btn-shimmer flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl font-semibold"
                >
                    <Plus className="w-4 h-4" />
                    Add Competitor
                </button>
            </div>

            {/* Add Form */}
            {showAdd && (
                <>
                    <div className="glass-panel rounded-xl p-4 flex items-center gap-3">
                        <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                        <input
                            type="text"
                            placeholder="Enter competitor domain (e.g. competitor.com)"
                            value={newDomain}
                            onChange={(e) => setNewDomain(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                            className="input-premium flex-1 bg-transparent text-sm"
                            autoFocus
                        />
                        <button
                            onClick={handleAdd}
                            disabled={!newDomain.trim() || addCompetitor.isPending}
                            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                        >
                            {addCompetitor.isPending ? 'Adding...' : 'Add'}
                        </button>
                        <button onClick={() => { setShowAdd(false); setNewDomain(''); setAddError(null); }} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    {addError && <p className="text-xs text-red-500 dark:text-red-400 px-1 -mt-4">{addError}</p>}
                </>
            )}

            {/* Competitor List */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                </div>
            ) : competitors.length === 0 ? (
                <div className="glass-panel rounded-2xl text-center py-14 px-6">
                    <Users className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3 animate-float" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">No competitors added yet.</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Add a competitor domain to compare keyword coverage.</p>
                </div>
            ) : (
                <div className="glass-panel rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
                    {competitors.map((comp: CompetitorDomain) => (
                        <div
                            key={comp.id}
                            className={`flex items-center justify-between px-4 py-3.5 transition-all duration-200 cursor-pointer ${analyzeDomain === comp.domain
                                ? 'bg-blue-50/80 dark:bg-blue-900/20'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                }`}
                            onClick={() => setAnalyzeDomain(analyzeDomain === comp.domain ? undefined : comp.domain)}
                        >
                            <div className="flex items-center gap-3">
                                <Globe className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                                <span className="font-medium text-sm text-slate-900 dark:text-slate-200">{comp.domain}</span>
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                    Added {new Date(comp.createdAt).toLocaleDateString()}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setAnalyzeDomain(comp.domain); }}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors font-medium"
                                >
                                    <BarChart3 className="w-3 h-3" />
                                    Analyze
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        window.confirm(`Remove ${comp.domain}?`) && removeCompetitor.mutate(comp.id);
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Gap Analysis Results */}
            {analyzeDomain && (
                <div className="glass-panel rounded-2xl p-6 animate-fade-slide-up">
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-blue-500" />
                        Gap Analysis: {analyzeDomain}
                    </h4>

                    {analysisLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                        </div>
                    ) : analysis ? (
                        <div className="space-y-4">
                            {/* Summary Stats */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 rounded-xl p-3.5 border border-blue-100 dark:border-blue-800/30">
                                    <p className="text-xs text-blue-600/70 dark:text-blue-400/70 font-medium">Overlap</p>
                                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-0.5">{analysis.overlapPct}%</p>
                                </div>
                                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-800/10 rounded-xl p-3.5 border border-emerald-100 dark:border-emerald-800/30">
                                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 font-medium">Shared</p>
                                    <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">{analysis.sharedKeywords.length}</p>
                                </div>
                                <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-900/20 dark:to-violet-800/10 rounded-xl p-3.5 border border-violet-100 dark:border-violet-800/30">
                                    <p className="text-xs text-violet-600/70 dark:text-violet-400/70 font-medium">Your Only</p>
                                    <p className="text-2xl font-bold text-violet-700 dark:text-violet-300 mt-0.5">{analysis.yourOnlyKeywords.length}</p>
                                </div>
                                <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-900/20 dark:to-amber-800/10 rounded-xl p-3.5 border border-amber-100 dark:border-amber-800/30">
                                    <p className="text-xs text-amber-600/70 dark:text-amber-400/70 font-medium">Their Only</p>
                                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-0.5">{analysis.theirOnlyKeywords.length}</p>
                                </div>
                            </div>

                            {/* Their-only keywords — opportunities */}
                            {analysis.theirOnlyKeywords.length > 0 && (
                                <div>
                                    <h5 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Keyword Opportunities (they rank, you don't)</h5>
                                    <div className="flex flex-wrap gap-2">
                                        {analysis.theirOnlyKeywords.slice(0, 20).map((kw: string) => (
                                            <span key={kw} className="inline-flex items-center px-2.5 py-1 text-xs bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/30 rounded-lg">
                                                {kw}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Shared keywords table */}
                            {analysis.sharedKeywords.length > 0 && (
                                <div>
                                    <h5 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Shared Keywords</h5>
                                    <div className="max-h-64 overflow-y-auto">
                                        <table className="w-full text-sm">
                                            <thead className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-800/50 sticky top-0">
                                                <tr>
                                                    <th className="text-left px-3 py-2 font-medium">Keyword</th>
                                                    <th className="text-right px-3 py-2 font-medium">Your Position</th>
                                                    <th className="text-right px-3 py-2 font-medium">Their Estimate</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                                {analysis.sharedKeywords.map((sk: { keyword: string; yourPosition: number; theirEstimate: string }) => (
                                                    <tr key={sk.keyword} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                                        <td className="px-3 py-2 text-slate-900 dark:text-slate-200">{sk.keyword}</td>
                                                        <td className="px-3 py-2 text-right font-medium">
                                                            <span className={sk.yourPosition <= 10 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}>
                                                                #{Math.round(sk.yourPosition)}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">{sk.theirEstimate}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">No analysis data available.</p>
                    )}
                </div>
            )}
        </div>
    );
}
