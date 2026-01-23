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
    History,
    RotateCcw
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
    const [syncingProductId, setSyncingProductId] = useState<string | null>(null);
    const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);
    const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});

    const [stats, setStats] = useState({ total: 0, needsSync: 0, inSync: 0 });

    /**
     * Cancel a stuck BOM sync job via the API.
     * Clears the 'already running' state and allows a fresh sync.
     */
    async function handleCancelSync() {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/inventory/bom/sync-cancel', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                setSyncResult(null);
                await fetchPendingChanges();
            }
        } catch (err) {
            Logger.error('Failed to cancel sync', { error: err });
        }
    }

    function handleRefresh() {
        fetchPendingChanges();
        fetchSyncHistory();
    }

    async function handleSyncSingle(productId: string, variationId: number) {
        if (!currentAccount) return;
        const key = `${productId}-${variationId}`;
        setSyncingProductId(key);
        // Clear previous error for this product
        setSyncErrors(prev => ({ ...prev, [key]: '' }));
        try {
            const res = await fetch(`/api/inventory/products/${productId}/bom/sync?variationId=${variationId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            const data = await res.json();
            if (!res.ok) {
                // Store error for this product
                const errorMsg = data.error || data.result?.error || 'Sync failed';
                setSyncErrors(prev => ({ ...prev, [key]: errorMsg }));
                Logger.error('Sync failed', { productId, variationId, error: errorMsg });
            } else {
                // Success - clear any previous error
                setSyncErrors(prev => ({ ...prev, [key]: '' }));
                await fetchPendingChanges();
                await fetchSyncHistory();
            }
        } catch (err: any) {
            const errorMsg = err.message || 'Network error';
            setSyncErrors(prev => ({ ...prev, [key]: errorMsg }));
            Logger.error('Failed to sync single product', { error: err });
        } finally {
            setSyncingProductId(null);
        }
    }

    useEffect(() => {
        if (currentAccount && token) {
            fetchPendingChanges();
            fetchSyncHistory();
            checkSyncStatus();
        }
    }, [currentAccount, token]);

    /**
     * Check if a BOM sync job is already running on page load.
     */
    async function checkSyncStatus() {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/inventory/bom/sync-status', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.isSyncing) {
                    // Show the "already in progress" banner
                    setSyncResult({ synced: -3, failed: 0 });
                }
            }
        } catch (err) {
            Logger.error('Failed to check sync status', { error: err });
        }
    }

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
                },
                body: JSON.stringify({})
            });

            if (res.ok) {
                const data = await res.json();

                // Queue-based response - sync dispatched to background worker
                if (data.status === 'queued' || data.status === 'started') {
                    // Show "queued" message
                    setSyncResult({ synced: -2, failed: 0 }); // -2 = "queued" indicator

                    // Poll for updates every 5 seconds for 60 seconds max
                    let pollCount = 0;
                    const pollInterval = setInterval(async () => {
                        pollCount++;
                        await fetchPendingChanges();
                        await fetchSyncHistory();

                        // Stop polling after 12 attempts (60 seconds)
                        if (pollCount >= 12) {
                            clearInterval(pollInterval);
                            setIsSyncing(false);
                        }
                    }, 5000);

                    // Safety timeout
                    setTimeout(() => {
                        clearInterval(pollInterval);
                        setIsSyncing(false);
                    }, 60000);
                } else if (data.status === 'already_running') {
                    // Sync already in progress
                    setSyncResult({ synced: -3, failed: 0 }); // -3 = "already running" indicator
                    setIsSyncing(false);
                } else {
                    // Legacy sync response (synced/failed counts)
                    setSyncResult({ synced: data.synced || 0, failed: data.failed || 0 });
                    await fetchPendingChanges();
                    await fetchSyncHistory();
                    setIsSyncing(false);
                }
            } else {
                setSyncResult({ synced: 0, failed: -1 });
                setIsSyncing(false);
            }
        } catch (err) {
            Logger.error('Failed to sync all', { error: err });
            setSyncResult({ synced: 0, failed: -1 });
            setIsSyncing(false);
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-end border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">BOM Inventory Sync</h1>
                    <p className="text-sm text-gray-500">Sync calculated stock from BOM to WooCommerce • Auto-syncs hourly</p>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleRefresh}
                        disabled={isLoadingPending}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-gray-600 hover:bg-gray-100 transition-all border border-gray-200"
                        title="Refresh"
                    >
                        <RotateCcw size={18} className={isLoadingPending ? 'animate-spin' : ''} />
                    </button>
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
                        {isSyncing ? 'Syncing...' : `Sync All (${stats.needsSync})`}
                    </button>
                </div>
            </div>

            {/* Sync Result Toast */}
            {syncResult && (
                <div className={`p-4 rounded-lg border ${syncResult.synced === -2
                    ? 'bg-blue-50 border-blue-200 text-blue-800'
                    : syncResult.synced === -3
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : syncResult.failed === 0 && syncResult.synced >= 0
                            ? 'bg-green-50 border-green-200 text-green-800'
                            : syncResult.failed === -1
                                ? 'bg-red-50 border-red-200 text-red-800'
                                : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}>
                    {syncResult.synced === -2 ? (
                        <span className="flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            Sync queued! Processing in background... Refreshing status automatically.
                        </span>
                    ) : syncResult.synced === -3 ? (
                        <span className="flex items-center justify-between w-full">
                            <span>A sync is already in progress for this account. Please wait for it to complete.</span>
                            <button
                                onClick={handleCancelSync}
                                className="ml-4 px-3 py-1 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
                            >
                                Cancel Sync
                            </button>
                        </span>
                    ) : syncResult.failed === -1 ? (
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

            {/* Pending Changes Table - Only shows out-of-sync products */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-amber-50/50 flex items-center gap-2">
                    <AlertTriangle size={18} className="text-amber-600" />
                    <h2 className="font-semibold text-gray-900">Pending Changes</h2>
                    <span className="text-sm text-gray-500">({stats.needsSync} products need sync)</span>
                </div>

                {isLoadingPending ? (
                    <div className="p-12 text-center text-gray-400">
                        <Loader2 className="animate-spin inline mr-2" /> Loading...
                    </div>
                ) : stats.needsSync === 0 ? (
                    <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-2">
                        <CheckCircle size={48} className="text-green-300" />
                        <p className="text-green-700 font-medium">All BOM products are in sync!</p>
                        <p className="text-sm text-gray-400">No pending changes to sync to WooCommerce</p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <tr>
                                <th className="px-6 py-3 text-left">Product</th>
                                <th className="px-6 py-3 text-center">WooCommerce</th>
                                <th className="px-6 py-3 text-center">Difference</th>
                                <th className="px-6 py-3 text-center">Effective</th>
                                <th className="px-6 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {pendingChanges.filter(item => item.needsSync).map((item) => {
                                const diff = item.effectiveStock - (item.currentWooStock ?? 0);
                                const key = `${item.productId}-${item.variationId}`;
                                const isSyncingThis = syncingProductId === key;
                                const errorMsg = syncErrors[key];
                                return (
                                    <tr key={key} className="hover:bg-gray-50">
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
                                                    {/* Show error message under product name */}
                                                    {errorMsg && (
                                                        <div className="mt-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                                                            ⚠ {errorMsg}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="text-lg font-bold text-gray-500">
                                                {item.currentWooStock ?? '—'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={`text-lg font-bold ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {diff > 0 ? '+' : ''}{diff}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="text-lg font-bold text-blue-600">
                                                {item.effectiveStock}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <button
                                                onClick={() => handleSyncSingle(item.productId, item.variationId)}
                                                disabled={isSyncingThis || isSyncing}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                                            >
                                                {isSyncingThis ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                ) : (
                                                    <RefreshCw size={14} />
                                                )}
                                                Sync
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* All BOM Products - Collapsible */}
            <details className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <summary className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 cursor-pointer hover:bg-gray-100 flex items-center gap-2">
                    <Package size={18} className="text-gray-400" />
                    <h2 className="font-semibold text-gray-900">All BOM Products</h2>
                    <span className="text-sm text-gray-500">({stats.total} total)</span>
                </summary>

                {!isLoadingPending && pendingChanges.length > 0 && (
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
                                <tr key={`all-${item.productId}-${item.variationId}`} className="hover:bg-gray-50">
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
            </details>

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
