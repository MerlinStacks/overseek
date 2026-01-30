import { useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetProps } from './WidgetRegistry';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

/**
 * Compact widget displaying the current count of live visitors.
 * Polls the tracking API every 10 seconds for real-time updates.
 * Also shows total visitors in the last 24 hours.
 */
export function VisitorCountWidget(_props: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [count, setCount] = useState<number>(0);
    const [visitors24h, setVisitors24h] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            // Fetch live visitors and 24h stats in parallel
            const [liveRes, visitors24hRes] = await Promise.all([
                fetch('/api/tracking/live', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                }),
                fetch('/api/tracking/visitors-24h', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                })
            ]);

            if (liveRes.ok) {
                const data = await liveRes.json();
                setCount(Array.isArray(data) ? data.length : 0);
            }

            if (visitors24hRes.ok) {
                const data = await visitors24hRes.json();
                setVisitors24h(data.count || 0);
            }
        } catch (error) {
            Logger.error('Failed to fetch visitor data', { error: error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    // Visibility-aware polling with tab coordination: only leader tab polls
    useVisibilityPolling(fetchData, 10000, [fetchData], 'visitor-count');

    return (
        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl p-6 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/60 dark:border-slate-700/50 flex flex-col h-full justify-center items-center relative overflow-hidden transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)]">
            {/* Pulsing Indicator with glow */}
            <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-full">
                <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Live</span>
            </div>

            {/* Count Display */}
            <div className="text-center relative z-10">
                {loading ? (
                    <div className="w-12 h-12 border-4 border-blue-200 dark:border-blue-800 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
                ) : (
                    <span className="text-5xl font-bold text-slate-900 dark:text-white tracking-tight">{count}</span>
                )}
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">Active Visitors</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{visitors24h.toLocaleString()} in last 24h</p>
            </div>

            {/* Background Icon with gradient */}
            <div className="absolute -bottom-6 -right-6 opacity-[0.06] dark:opacity-[0.08] z-0">
                <Users size={100} className="text-blue-600 dark:text-blue-400" />
            </div>
        </div>
    );
}
