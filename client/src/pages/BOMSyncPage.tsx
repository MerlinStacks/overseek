/**
 * BOM Inventory Sync Dashboard
 * 
 * Shows pending BOM inventory changes and sync history.
 * Allows bulk syncing all out-of-sync products to WooCommerce.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Logger } from '../utils/logger';
import {
    RefreshCw,
    Package,
    Loader2,
    CheckCircle,
    AlertTriangle,
    Clock,
    ArrowRight,
    History
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface PendingChange {
    productId: string;
    wooId: number;
    name: string;
    sku: string | null;
    mainImage: string | null;
    variationId: number;
    currentWooStock: number | null;
    effectiveStock: number;
    needsSync: boolean;
    components: {
        childName: string;
        requiredQty: number;
        childStock: number;
        buildableUnits: number;
    }[];
}

interface SyncLogEntry {
    id: string;
    productId: string;
    productName: string;
    productSku: string | null;
    previousStock: number | null;
    newStock: number | null;
    trigger: string;
    createdAt: string;
}

export function BOMSyncPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
    const [syncHistory, setSyncHistory] = useState<SyncLogEntry[]>([]);
    const [isLoadingPending, setIsLoadingPending] = useState(true);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);

    const [stats, setStats] = useState({ total: 0, needsSync: 0, inSync: 0 });

    useEffect(() => {
        if (currentAccount && token) {
            fetchPendingChanges();
            fetchSyncHistory();
        }
    }, [currentAccount, token]);

    async function fetchPendingChanges() {
        setIsLoadingPending(true);
        try {
            const res = await fetch('/api/inventory/bom/pending-changes', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount!.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setPendingChanges(data.products || []);
                setStats({ total: data.total, needsSync: data.needsSync, inSync: data.inSync });
            }
        } catch (err) {
            Logger.error('Failed to fetch pending changes', { error: err });
        } finally {
            setIsLoadingPending(false);
        }
    }

    async function fetchSyncHistory() {
        setIsLoadingHistory(true);
        try {
            const res = await fetch('/api/inventory/bom/sync-history?limit=20', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount!.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setSyncHistory(data.logs || []);
            }
        } catch (err) {
            Logger.error('Failed to fetch sync history', { error: err });
        } finally {
            setIsLoadingHistory(false);
        }
    }

    async function handleSyncAll() {
        if (!currentAccount) return;

        setIsSyncing(true);
        setSyncResult(null);

        try {
            const res = await fetch('/api/inventory/bom/sync-all', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setSyncResult({ synced: data.synced, failed: data.failed });
                // Refresh data
                await fetchPendingChanges();
                await fetchSyncHistory();
            }
        } catch (err) {
            Logger.error('Failed to sync all', { error: err });
            setSyncResult({ synced: 0, failed: -1 });
        } finally {
            setIsSyncing(false);
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-end border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">BOM Inventory Sync</h1>
                    <p className="text-sm text-gray-500">Sync calculated stock from BOM to WooCommerce</p>
                </div>

                <button
                    onClick={handleSyncAll}
                    disabled={isSyncing || stats.needsSync === 0}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${stats.needsSync === 0
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                >
                    {isSyncing ? (
                        <Loader2 size={18} className="animate-spin" />
                    ) : (
                        <RefreshCw size={18} />
                    )}
                    {isSyncing ? 'Syncing...' : `Sync All Changes (${stats.needsSync})`}
                </button>
            </div>

            {/* Sync Result Toast */}
            {syncResult && (
                <div className={`p-4 rounded-lg border ${syncResult.failed === 0
                        ? 'bg-green-50 border-green-200 text-green-800'
                        : syncResult.failed === -1
                            ? 'bg-red-50 border-red-200 text-red-800'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}>
                    {syncResult.failed === -1 ? (
                        <span>Sync failed. Please try again.</span>
                    ) : (
                        <span>
                            Synced {syncResult.synced} products.
                            {syncResult.failed > 0 && ` ${syncResult.failed} failed.`}
                        </span>
                    )}
                </div>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="text-sm text-gray-500 mb-1">Total BOM Products</div>
                    <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
                </div>
                <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
                    <div className="flex items-center gap-2 text-sm text-amber-700 mb-1">
                        <AlertTriangle size={14} />
                        Needs Sync
                    </div>
                    <div className="text-2xl font-bold text-amber-800">{stats.needsSync}</div>
                </div>
                <div className="bg-green-50 rounded-xl border border-green-200 p-4">
                    <div className="flex items-center gap-2 text-sm text-green-700 mb-1">
                        <CheckCircle size={14} />
                        In Sync
                    </div>
                    <div className="text-2xl font-bold text-green-800">{stats.inSync}</div>
                </div>
            </div>

            {/* Pending Changes Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <h2 className="font-semibold text-gray-900">Pending Changes</h2>
                </div>

                {isLoadingPending ? (
                    <div className="p-12 text-center text-gray-400">
                        <Loader2 className="animate-spin inline mr-2" /> Loading...
                    </div>
                ) : pendingChanges.length === 0 ? (
                    <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-2">
                        <Package size={48} className="text-gray-300" />
                        <p>No BOM products found</p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <tr>
                                <th className="px-6 py-3 text-left">Product</th>
                                <th className="px-6 py-3 text-center">WooCommerce Stock</th>
                                <th className="px-6 py-3 text-center"></th>
                                <th className="px-6 py-3 text-center">Effective Stock</th>
                                <th className="px-6 py-3 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {pendingChanges.map((item) => (
                                <tr key={`${item.productId}-${item.variationId}`} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">
                                                {item.mainImage ? (
                                                    <img src={item.mainImage} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                        <Package size={16} />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="font-medium text-gray-900">{item.name}</div>
                                                {item.variationId > 0 && (
                                                    <div className="text-xs text-purple-600">Variant #{item.variationId}</div>
                                                )}
                                                {item.sku && <div className="text-xs text-gray-500 font-mono">{item.sku}</div>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className="text-lg font-bold text-gray-600">
                                            {item.currentWooStock ?? '—'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-center text-gray-400">
                                        <ArrowRight size={18} />
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className="text-lg font-bold text-blue-600">
                                            {item.effectiveStock}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {item.needsSync ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                                <AlertTriangle size={12} />
                                                Needs Sync
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                <CheckCircle size={12} />
                                                In Sync
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Sync History */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                    <History size={18} className="text-gray-400" />
                    <h2 className="font-semibold text-gray-900">Sync History</h2>
                </div>

                {isLoadingHistory ? (
                    <div className="p-12 text-center text-gray-400">
                        <Loader2 className="animate-spin inline mr-2" /> Loading...
                    </div>
                ) : syncHistory.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        <p>No sync history yet</p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <tr>
                                <th className="px-6 py-3 text-left">Product</th>
                                <th className="px-6 py-3 text-center">Stock Change</th>
                                <th className="px-6 py-3 text-left">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {syncHistory.map((log) => (
                                <tr key={log.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-3">
                                        <div className="font-medium text-gray-900">{log.productName}</div>
                                        {log.productSku && <div className="text-xs text-gray-500 font-mono">{log.productSku}</div>}
                                    </td>
                                    <td className="px-6 py-3 text-center">
                                        <span className="font-mono">
                                            <span className="text-gray-500">{log.previousStock ?? '?'}</span>
                                            <span className="mx-2 text-gray-400">→</span>
                                            <span className="text-blue-600 font-bold">{log.newStock ?? '?'}</span>
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 text-sm text-gray-500 flex items-center gap-1">
                                        <Clock size={14} />
                                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
