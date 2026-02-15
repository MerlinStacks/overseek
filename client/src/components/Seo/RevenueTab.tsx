/**
 * RevenueTab — Keyword revenue attribution table.
 *
 * Shows which keywords drive the most revenue, with columns for
 * clicks, sessions, conversions, revenue, and revenue per click.
 */

import { Loader2, DollarSign, TrendingUp } from 'lucide-react';
import { useKeywordRevenue } from '../../hooks/useSeoKeywords';
import type { KeywordRevenue } from '../../hooks/useSeoKeywords';

export function RevenueTab() {
    const { data, isLoading } = useKeywordRevenue();
    const keywords = data?.keywords || [];

    // Summary stats
    const totalRevenue = keywords.reduce((s: number, k: KeywordRevenue) => s + k.estimatedRevenue, 0);
    const totalClicks = keywords.reduce((s: number, k: KeywordRevenue) => s + k.clicks, 0);
    const totalConversions = keywords.reduce((s: number, k: KeywordRevenue) => s + k.conversions, 0);

    return (
        <div className="space-y-6 animate-fade-slide-up">
            <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Revenue Attribution</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    See which keywords drive the most organic revenue
                </p>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                </div>
            ) : keywords.length === 0 ? (
                <div className="glass-panel rounded-2xl text-center py-14 px-6">
                    <DollarSign className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3 animate-float" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">No revenue data yet.</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Revenue is attributed once tracking and orders are connected.</p>
                </div>
            ) : (
                <>
                    {/* Summary Stats */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-800/10 rounded-xl p-4 border border-emerald-100 dark:border-emerald-800/30">
                            <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 font-medium">Total Organic Revenue</p>
                            <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 rounded-xl p-4 border border-blue-100 dark:border-blue-800/30">
                            <p className="text-xs text-blue-600/70 dark:text-blue-400/70 font-medium">Organic Clicks</p>
                            <p className="text-3xl font-bold text-blue-700 dark:text-blue-300 mt-1">{totalClicks.toLocaleString()}</p>
                        </div>
                        <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-900/20 dark:to-violet-800/10 rounded-xl p-4 border border-violet-100 dark:border-violet-800/30">
                            <p className="text-xs text-violet-600/70 dark:text-violet-400/70 font-medium">Conversions</p>
                            <p className="text-3xl font-bold text-violet-700 dark:text-violet-300 mt-1">{totalConversions.toLocaleString()}</p>
                        </div>
                    </div>

                    {/* Revenue Table */}
                    <div className="glass-panel rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-800/50">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-medium">Keyword</th>
                                        <th className="text-right px-4 py-3 font-medium">Clicks</th>
                                        <th className="text-right px-4 py-3 font-medium">Sessions</th>
                                        <th className="text-right px-4 py-3 font-medium">Conversions</th>
                                        <th className="text-right px-4 py-3 font-medium">Revenue</th>
                                        <th className="text-right px-4 py-3 font-medium">Rev/Click</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                    {keywords.map((kw: KeywordRevenue, i: number) => (
                                        <tr key={kw.keyword} className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors animate-fade-slide-up ${i < 8 ? `animation-delay-${i * 50}` : ''}`}>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    {i < 3 && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
                                                    <span className="font-medium text-slate-900 dark:text-slate-200">{kw.keyword}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{kw.clicks.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{kw.sessions.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{kw.conversions}</td>
                                            <td className="px-4 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                                ${kw.estimatedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                                                ${kw.revenuePerClick.toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
