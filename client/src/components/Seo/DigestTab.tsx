/**
 * DigestTab — Weekly SEO performance digest preview.
 */

import { Loader2, Mail, TrendingUp, TrendingDown, AlertTriangle, Star, Eye } from 'lucide-react';
import { useSeoDigest } from '../../hooks/useSeoKeywords';
import type { SeoDigest } from '../../hooks/useSeoKeywords';

type Mover = SeoDigest['topMovers']['improved'][number];
type NewKw = SeoDigest['newKeywords'][number];

export function DigestTab() {
    const { data: digest, isLoading } = useSeoDigest();

    if (isLoading) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>;
    }

    if (!digest) {
        return (
            <div className="glass-panel rounded-2xl text-center py-14 px-6 animate-fade-slide-up">
                <Mail className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3 animate-float" />
                <p className="text-sm text-slate-500 dark:text-slate-400">No digest available yet.</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Digests are generated weekly once you have tracked keywords.</p>
            </div>
        );
    }

    const s = digest.summary;
    const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

    return (
        <div className="space-y-6 animate-fade-slide-up">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Mail className="w-5 h-5 text-blue-500" /> SEO Digest
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        {new Date(digest.period.start).toLocaleDateString()} — {new Date(digest.period.end).toLocaleDateString()}
                    </p>
                </div>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 rounded-xl p-4 border border-blue-100 dark:border-blue-800/30">
                    <p className="text-xs text-blue-600/70 dark:text-blue-400/70 font-medium">Clicks</p>
                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-0.5">{s.totalClicks.toLocaleString()}</p>
                    <p className={`text-xs font-medium mt-1 ${s.clicksChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtPct(s.clicksChange)}</p>
                </div>
                <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-900/20 dark:to-violet-800/10 rounded-xl p-4 border border-violet-100 dark:border-violet-800/30">
                    <p className="text-xs text-violet-600/70 dark:text-violet-400/70 font-medium">Impressions</p>
                    <p className="text-2xl font-bold text-violet-700 dark:text-violet-300 mt-0.5">{s.totalImpressions.toLocaleString()}</p>
                    <p className={`text-xs font-medium mt-1 ${s.impressionsChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtPct(s.impressionsChange)}</p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-900/20 dark:to-amber-800/10 rounded-xl p-4 border border-amber-100 dark:border-amber-800/30">
                    <p className="text-xs text-amber-600/70 dark:text-amber-400/70 font-medium">Avg Position</p>
                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-0.5">#{Math.round(s.avgPosition)}</p>
                    <p className={`text-xs font-medium mt-1 ${s.positionChange <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {s.positionChange > 0 ? '+' : ''}{s.positionChange.toFixed(1)} pos
                    </p>
                </div>
            </div>

            {/* Top Movers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Improved */}
                <div className="glass-panel rounded-xl p-4">
                    <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 mb-3">
                        <TrendingUp className="w-4 h-4" /> Top Improvers
                    </h4>
                    {digest.topMovers.improved.length === 0 ? (
                        <p className="text-xs text-slate-400">No improvements this period.</p>
                    ) : (
                        <div className="space-y-2">
                            {digest.topMovers.improved.map((m: Mover) => (
                                <div key={m.keyword} className="flex items-center justify-between text-sm">
                                    <span className="text-slate-900 dark:text-slate-200 truncate mr-2">{m.keyword}</span>
                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                                        #{m.oldPosition} → #{m.newPosition}
                                        <span className="text-xs ml-1">(+{Math.abs(m.delta).toFixed(1)})</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {/* Declined */}
                <div className="glass-panel rounded-xl p-4">
                    <h4 className="text-sm font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5 mb-3">
                        <TrendingDown className="w-4 h-4" /> Biggest Drops
                    </h4>
                    {digest.topMovers.declined.length === 0 ? (
                        <p className="text-xs text-slate-400">No declines this period.</p>
                    ) : (
                        <div className="space-y-2">
                            {digest.topMovers.declined.map((m: Mover) => (
                                <div key={m.keyword} className="flex items-center justify-between text-sm">
                                    <span className="text-slate-900 dark:text-slate-200 truncate mr-2">{m.keyword}</span>
                                    <span className="text-rose-600 dark:text-rose-400 font-medium shrink-0">
                                        #{m.oldPosition} → #{m.newPosition}
                                        <span className="text-xs ml-1">(-{Math.abs(m.delta).toFixed(1)})</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* New Keywords */}
            {digest.newKeywords.length > 0 && (
                <div className="glass-panel rounded-xl p-4">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 mb-3">
                        <Star className="w-4 h-4 text-amber-500" /> Newly Discovered Keywords
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {digest.newKeywords.map((nk: NewKw) => (
                            <span key={nk.keyword} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/30 rounded-lg">
                                <Eye className="w-3 h-3" />
                                {nk.keyword}
                                <span className="text-amber-500/60 dark:text-amber-500/40">#{Math.round(nk.position)}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Alerts */}
            {digest.alerts.length > 0 && (
                <div className="glass-panel rounded-xl p-4 border-l-4 border-amber-500">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 mb-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" /> Alerts
                    </h4>
                    <ul className="space-y-1">
                        {digest.alerts.map((a: string, i: number) => (
                            <li key={i} className="text-sm text-slate-600 dark:text-slate-400">• {a}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
