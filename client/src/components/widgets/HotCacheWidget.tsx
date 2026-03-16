/**
 * HotCacheWidget - Shows Hot Tier cache status and controls
 * 
 * Displays cached data counts and provides refresh controls.
 */

import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { Database, RefreshCw, HardDrive, Trash2 } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { getCacheStats, clearAccountCache, hotTierDB } from '../../services/db';
import { WidgetProps } from './WidgetRegistry';

interface CacheStats {
    orders: number;
    products: number;
    customers: number;
    lastSync: {
        orders: number | null;
        products: number | null;
        customers: number | null;
    };
}

export function HotCacheWidget({ className }: WidgetProps) {
    const { currentAccount } = useAccount();
    const [stats, setStats] = useState<CacheStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [clearing, setClearing] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);

    const loadStats = async () => {
        if (!currentAccount?.id) return;
        setLoading(true);
        try {
            const data = await getCacheStats(currentAccount.id);
            setStats(data);
        } catch (error) {
            Logger.error('Failed to load cache stats', { error: error });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStats();
    }, [currentAccount?.id]);

    /** Two-step clear: first click shows confirmation, second click executes */
    const handleClear = async () => {
        if (!currentAccount?.id) return;

        if (!confirmClear) {
            setConfirmClear(true);
            // Auto-dismiss after 3 seconds
            setTimeout(() => setConfirmClear(false), 3000);
            return;
        }

        setClearing(true);
        setConfirmClear(false);
        try {
            await clearAccountCache(currentAccount.id);
            await loadStats();
        } catch (error) {
            Logger.error('Failed to clear cache', { error: error });
        } finally {
            setClearing(false);
        }
    };

    const formatTime = (timestamp: number | null) => {
        if (!timestamp) return 'Never';
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    };

    const totalItems = stats ? stats.orders + stats.products + stats.customers : 0;

    return (
        <div className={`bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-4 h-full shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${className}`}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <HardDrive className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="font-semibold text-slate-900 dark:text-white">Hot Cache</h3>
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={loadStats}
                        disabled={loading}
                        className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        title="Refresh stats"
                    >
                        <RefreshCw className={`w-4 h-4 text-slate-500 dark:text-slate-400 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={handleClear}
                        disabled={clearing || totalItems === 0}
                        className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${confirmClear ? 'bg-red-100 dark:bg-red-500/20 hover:bg-red-200' : 'hover:bg-red-50 dark:hover:bg-red-500/10'}`}
                        title={confirmClear ? 'Click again to confirm' : 'Clear cache'}
                    >
                        <Trash2 className={`w-4 h-4 ${confirmClear ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-5 h-5 text-slate-400 dark:text-slate-500 animate-spin" />
                </div>
            ) : stats ? (
                <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{stats.products}</div>
                            <div className="text-xs text-blue-600 dark:text-blue-500">Products</div>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-green-700 dark:text-green-400">{stats.orders}</div>
                            <div className="text-xs text-green-600 dark:text-green-500">Orders</div>
                        </div>
                        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-purple-700 dark:text-purple-400">{stats.customers}</div>
                            <div className="text-xs text-purple-600 dark:text-purple-500">Customers</div>
                        </div>
                    </div>

                    <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500 dark:text-slate-400">Products synced</span>
                            <span className="text-slate-700 dark:text-slate-300">{formatTime(stats.lastSync.products)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500 dark:text-slate-400">Orders synced</span>
                            <span className="text-slate-700 dark:text-slate-300">{formatTime(stats.lastSync.orders)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500 dark:text-slate-400">Customers synced</span>
                            <span className="text-slate-700 dark:text-slate-300">{formatTime(stats.lastSync.customers)}</span>
                        </div>
                    </div>

                    {totalItems === 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">
                            No data cached yet. Visit Products, Orders, or Customers to populate.
                        </p>
                    )}
                </div>
            ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                    Unable to load cache stats
                </p>
            )}
        </div>
    );
}

export default HotCacheWidget;
