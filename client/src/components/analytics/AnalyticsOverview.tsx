/**
 * AnalyticsOverview - Rich overview panel for the live analytics page.
 *
 * Why this exists: the previous version was a bare 38-line skeleton with two
 * white cards. This redesign surfaces stat cards, a geo summary, and a compact
 * activity feed directly on the overview tab so users get instant context
 * without needing to tab into sub-views.
 */

import { useMemo } from 'react';
import { Users, ShoppingCart, DollarSign, Globe, ArrowRight } from 'lucide-react';
import { LiveSession } from '../../types/analytics';
import { VisitorsTable } from './VisitorsTable';
import { formatCurrency } from '../../utils/format';

interface AnalyticsOverviewProps {
    visitors: LiveSession[];
    carts: LiveSession[];
    setActiveView: (view: string) => void;
    onVisitorClick?: (visitorId: string) => void;
}

/** Country-code → flag emoji. Falls back to 🌍 for unknown codes. */
function getFlagEmoji(code: string | null): string {
    if (!code || code.length !== 2) return '🌍';
    const pts = code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0));
    return String.fromCodePoint(...pts);
}

/** Minute-level recency bucket for the activity bar. */
function getMinutesAgo(isoDate: string): number {
    return Math.floor((Date.now() - new Date(isoDate).getTime()) / 60000);
}

export const AnalyticsOverview = ({ visitors, carts, setActiveView, onVisitorClick }: AnalyticsOverviewProps) => {
    const totalCartValue = useMemo(
        () => carts.reduce((sum, c) => sum + Number(c.cartValue || 0), 0),
        [carts]
    );

    /** Top 5 countries, computed from the live visitors array. */
    const topCountries = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const v of visitors) {
            const key = v.country || 'Unknown';
            counts[key] = (counts[key] || 0) + 1;
        }
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
    }, [visitors]);

    /**
     * Activity pulse — visitors per minute for the last 10 minutes.
     * Pure frontend calc, no new endpoint needed.
     */
    const activityBars = useMemo(() => {
        const bars = new Array(10).fill(0);
        for (const v of visitors) {
            const ago = getMinutesAgo(v.lastActiveAt);
            if (ago >= 0 && ago < 10) bars[ago]++;
        }
        return bars.reverse(); // oldest → newest left-to-right
    }, [visitors]);

    const maxBar = Math.max(...activityBars, 1);

    return (
        <div className="space-y-6">
            {/* ── Stat Cards ─────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Live Visitors */}
                <div className="bg-white p-5 rounded-xl shadow-xs border border-gray-100 flex items-center gap-4">
                    <div className="p-3 bg-blue-50 rounded-xl">
                        <Users className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-3xl font-bold text-gray-900">{visitors.length}</span>
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        </div>
                        <p className="text-sm text-gray-500">Live Visitors</p>
                    </div>
                </div>

                {/* Active Carts */}
                <div className="bg-white p-5 rounded-xl shadow-xs border border-gray-100 flex items-center gap-4">
                    <div className="p-3 bg-amber-50 rounded-xl">
                        <ShoppingCart className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                        <span className="text-3xl font-bold text-gray-900">{carts.length}</span>
                        <p className="text-sm text-gray-500">Active Carts</p>
                    </div>
                </div>

                {/* Potential Revenue */}
                <div className="bg-white p-5 rounded-xl shadow-xs border border-gray-100 flex items-center gap-4">
                    <div className="p-3 bg-green-50 rounded-xl">
                        <DollarSign className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                        <span className="text-3xl font-bold text-gray-900">{formatCurrency(totalCartValue)}</span>
                        <p className="text-sm text-gray-500">Potential Revenue</p>
                    </div>
                </div>

                {/* Top Country */}
                <div className="bg-white p-5 rounded-xl shadow-xs border border-gray-100 flex items-center gap-4">
                    <div className="p-3 bg-purple-50 rounded-xl">
                        <Globe className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                        <span className="text-3xl font-bold text-gray-900">
                            {topCountries.length > 0 ? topCountries[0][1] : 0}
                        </span>
                        <p className="text-sm text-gray-500">
                            {topCountries.length > 0 ? `From ${topCountries[0][0]}` : 'No data yet'}
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Activity Pulse + Geo ───────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Activity Bar */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-xs border border-gray-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900 text-sm">Activity Pulse</h3>
                        <span className="text-xs text-gray-400">Last 10 minutes</span>
                    </div>
                    <div className="flex items-end gap-1 h-20">
                        {activityBars.map((count, i) => (
                            <div
                                key={i}
                                className="flex-1 rounded-t-md bg-gradient-to-t from-blue-500 to-blue-400 transition-all duration-300"
                                style={{ height: `${Math.max((count / maxBar) * 100, 4)}%` }}
                                title={`${10 - i} min ago: ${count} visitor${count !== 1 ? 's' : ''}`}
                            />
                        ))}
                    </div>
                    <div className="flex justify-between mt-2 text-[10px] text-gray-400">
                        <span>10m ago</span>
                        <span>Now</span>
                    </div>
                </div>

                {/* Top Countries */}
                <div className="bg-white rounded-xl shadow-xs border border-gray-100 p-5">
                    <h3 className="font-semibold text-gray-900 text-sm mb-4">Top Locations</h3>
                    {topCountries.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No visitors right now</p>
                    ) : (
                        <div className="space-y-3">
                            {topCountries.map(([country, count]) => (
                                <div key={country} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">{getFlagEmoji(country)}</span>
                                        <span className="text-sm text-gray-700">{country}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 rounded-full transition-all"
                                                style={{ width: `${(count / visitors.length) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-xs font-medium text-gray-500 w-6 text-right">{count}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Recent Visitors Table ──────────────────────────── */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-900">Real-time Log</h3>
                    <button
                        onClick={() => setActiveView('realtime')}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                        View All <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                </div>
                <VisitorsTable data={visitors.slice(0, 5)} onVisitorClick={onVisitorClick} />
            </div>
        </div>
    );
};
