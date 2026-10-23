/**
 * AnalyticsOverview - Rich overview panel for the live analytics page.
 *
 * Why this exists: the previous version was a bare 38-line skeleton with two
 * white cards. This redesign surfaces stat cards, a geo summary, and a compact
 * activity feed directly on the overview tab so users get instant context
 * without needing to tab into sub-views.
 */

import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Metric, MetricStrip } from '../ui/MetricStrip';
import { LiveSession } from '../../types/analytics';
import { VisitorsTable } from './VisitorsTable';
import { useAccount } from '../../context/AccountContext';
import { cartAmount, cartMoney, flagEmoji, useLiveClock } from './liveDisplay';

interface AnalyticsOverviewProps {
    visitors: LiveSession[];
    carts: LiveSession[];
    setActiveView: (view: string) => void;
    onVisitorClick?: (visitorId: string) => void;
}

/** Minute-level recency bucket for the activity bar. */
function getMinutesAgo(isoDate: string, now: number): number {
    return Math.floor((now - new Date(isoDate).getTime()) / 60000);
}

export const AnalyticsOverview = ({ visitors, carts, setActiveView, onVisitorClick }: AnalyticsOverviewProps) => {
    const { currentAccount } = useAccount();
    const now = useLiveClock();
    const totalCartValue = useMemo(
        () => carts.reduce<number | null>((sum, cart) => {
            const value = cartAmount(cart.cartValue);
            if (sum === null || value === null || !Number.isFinite(sum + value)) return null;
            return sum + value;
        }, 0),
        [carts]
    );

    /** Top 5 countries, computed from the live visitors array. */
    const topCountries = useMemo(() => {
        const counts = new Map<string, number>();
        for (const v of visitors) {
            const key = v.country?.trim() || 'Unknown';
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return [...counts.entries()]
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
            const ago = getMinutesAgo(v.lastActiveAt, now);
            if (ago >= 0 && ago < 10) bars[ago]++;
        }
        return bars.reverse(); // oldest → newest left-to-right
    }, [visitors, now]);

    const maxBar = Math.max(...activityBars, 1);

    return (
        <div className="space-y-4">
            {/* ── Stat Cards ─────────────────────────────────────── */}
            <MetricStrip label="Live analytics summary">
                <Metric label="Live Visitors" value={visitors.length} hint={<span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />} />
                <Metric label="Active Carts" value={carts.length} />
                <Metric label="Current Cart Value (not revenue)" value={cartMoney(totalCartValue, currentAccount?.currency)} />
                <Metric label={topCountries.length > 0 ? `From ${topCountries[0][0]}` : 'No data yet'} value={topCountries.length > 0 ? topCountries[0][1] : 0} />
            </MetricStrip>

            {/* ── Activity Pulse + Geo ───────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Activity Bar */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-xs border border-gray-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900 text-sm">Activity Pulse</h3>
                        <span className="text-xs text-gray-400">Last 10 minutes</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">Latest activity per visitor, not a count of page views.</p>
                    <div role="img" aria-label={`Latest visitor activity by minute, oldest first: ${activityBars.join(', ')}`} className="flex items-end gap-1 h-20">
                        {activityBars.map((count, i) => (
                            <div
                                key={i}
                                        className="flex-1 rounded-t-md bg-blue-500 transition-all duration-300"
                                style={{ height: `${Math.max((count / maxBar) * 100, 4)}%` }}
                                title={`${i === 9 ? 'Less than 1 minute' : `${9 - i}–${10 - i} minutes`} ago: ${count} visitor${count !== 1 ? 's' : ''}`}
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
                                        <span aria-hidden="true" className="text-lg">{flagEmoji(country)}</span>
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
                        type="button"
                        onClick={() => setActiveView('realtime')}
                    className="text-sm text-[var(--brand-text)] hover:underline flex items-center gap-1"
                    >
                        View All <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                </div>
                <VisitorsTable data={visitors.slice(0, 5)} onVisitorClick={onVisitorClick} />
            </div>
        </div>
    );
};
