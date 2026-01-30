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

export function HotCacheWidget() {
    const { currentAccount } = useAccount();
    const [stats, setStats] = useState<CacheStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [clearing, setClearing] = useState(false);

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

    const handleClear = async () => {
        if (!currentAccount?.id) return;
        if (!confirm('Clear all cached data? This will be re-synced from the server.')) return;

        setClearing(true);
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
        <div className="bg-white rounded-xl border border-gray-200 p-4 h-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <HardDrive className="w-5 h-5 text-purple-600" />
                    <h3 className="font-semibold text-gray-900">Hot Cache</h3>
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={loadStats}
                        disabled={loading}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Refresh stats"
                    >
                        <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={handleClear}
                        disabled={clearing || totalItems === 0}
                        className="p-1.5 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Clear cache"
                    >
                        <Trash2 className="w-4 h-4 text-gray-500" />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
                </div>
            ) : stats ? (
                <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-blue-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-blue-700">{stats.products}</div>
                            <div className="text-xs text-blue-600">Products</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-green-700">{stats.orders}</div>
                            <div className="text-xs text-green-600">Orders</div>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-purple-700">{stats.customers}</div>
                            <div className="text-xs text-purple-600">Customers</div>
                        </div>
                    </div>

                    <div className="border-t pt-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Products synced</span>
                            <span className="text-gray-700">{formatTime(stats.lastSync.products)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Orders synced</span>
                            <span className="text-gray-700">{formatTime(stats.lastSync.orders)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Customers synced</span>
                            <span className="text-gray-700">{formatTime(stats.lastSync.customers)}</span>
                        </div>
                    </div>

                    {totalItems === 0 && (
                        <p className="text-xs text-gray-500 text-center py-2">
                            No data cached yet. Visit Products, Orders, or Customers to populate.
                        </p>
                    )}
                </div>
            ) : (
                <p className="text-sm text-gray-500 text-center py-4">
                    Unable to load cache stats
                </p>
            )}
        </div>
    );
}

export default HotCacheWidget;
