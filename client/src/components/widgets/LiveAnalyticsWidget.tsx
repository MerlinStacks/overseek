import { useState, useCallback, useRef, useMemo } from 'react';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Users, ShoppingCart, Activity, ArrowRight, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetProps } from './WidgetRegistry';
import { widgetCardClass, widgetSubtleTextClass } from './widgetStyles';

interface LiveSession {
    country: string;
    city: string;
    lastActiveAt: string;
    cartValue: number;
}

export function LiveAnalyticsWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const navigate = useNavigate();

    const [visitors, setVisitors] = useState<LiveSession[]>([]);
    const [loading, setLoading] = useState(true);
    const prevCountRef = useRef<number | null>(null);

    const fetchLiveStats = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch('/api/tracking/live', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json() as LiveSession[];
                if (prevCountRef.current === null) {
                    prevCountRef.current = (data || []).length;
                } else {
                    prevCountRef.current = visitors.length;
                }
                setVisitors(data || []);
            }
        } catch (error) {
            Logger.error('Failed to fetch live stats', { error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token, visitors.length]);

    useVisibilityPolling(fetchLiveStats, 10000, [fetchLiveStats], 'live-analytics');

    const activeCarts = visitors.filter((v) => Number(v.cartValue) > 0);
    const totalCartValue = activeCarts.reduce((acc, curr) => acc + Number(curr.cartValue), 0);

    const topCountries = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const v of visitors) {
            const key = v.country || 'Unknown';
            counts[key] = (counts[key] || 0) + 1;
        }
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
    }, [visitors]);

    const trendText = useMemo(() => {
        if (prevCountRef.current === null) return 'Active Visitors';
        const diff = visitors.length - prevCountRef.current;
        if (diff > 0) return `${diff} more since last check`;
        if (diff < 0) return `${Math.abs(diff)} fewer since last check`;
        return 'Active Visitors';
    }, [visitors.length]);

    return (
        <div className={`${widgetCardClass} p-6 flex flex-col h-full relative overflow-hidden ${className || ''}`}>
            <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                    <h3 className={`${widgetSubtleTextClass} font-medium`}>Live Now</h3>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-3xl font-bold text-slate-900 dark:text-white">{loading ? '-' : visitors.length}</span>
                        <span className="text-sm text-green-600 flex items-center gap-1 font-medium animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            {trendText}
                        </span>
                    </div>
                </div>
                <div className="p-2 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-lg text-white shadow-md shadow-blue-500/20">
                    <Activity className="w-5 h-5" />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4 relative z-10">
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <ShoppingCart className="w-4 h-4 text-orange-500" />
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Active Carts</span>
                    </div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{activeCarts.length}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Potential Revenue</span>
                    </div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                        {formatCurrency(totalCartValue)}
                    </p>
                </div>
            </div>

            {topCountries.length > 0 && (
                <div className="mb-4 relative z-10">
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1.5">Top Locations</div>
                    <div className="flex items-center gap-2">
                        {topCountries.map(([country, count]) => (
                            <span key={country} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 dark:bg-slate-700/50 rounded-md text-xs text-slate-600 dark:text-slate-300">
                                <Globe className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                                {country}
                                <span className="text-slate-400 dark:text-slate-500">({count})</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-auto relative z-10">
                <button
                    onClick={() => navigate('/analytics/live')}
                    className="text-sm text-blue-600 font-medium hover:text-blue-700 flex items-center gap-1 transition-colors"
                >
                    View Real-time Report <ArrowRight size={16} />
                </button>
            </div>

            <div className="absolute -bottom-6 -right-6 opacity-[0.06] dark:opacity-[0.08] z-0">
                <Users size={120} className="text-blue-600 dark:text-blue-400" />
            </div>
        </div>
    );
}
