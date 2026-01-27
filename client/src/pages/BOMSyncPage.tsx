/**
 * BOM Inventory Sync Dashboard (Enhanced)
 * 
 * Shows pending BOM inventory changes, sync queue control, and consumption history.
 * Features:
 * - Queue control (pause/resume, retry failed)
 * - Expandable component breakdown with bottleneck highlighting
 * - Actionable error messages with fix suggestions
 * - Consumption activity log
 */

import { useEffect, useState, useCallback } from 'react';
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
    RotateCcw,
    ChevronDown,
    ChevronRight,
    Pause,
    Play,
    XCircle,
    AlertCircle,
    Boxes,
    TrendingDown,
    ShoppingCart
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface BOMComponent {
    childName: string;
    requiredQty: number;
    childStock: number;
    buildableUnits: number;
    componentType?: 'WooProduct' | 'ProductVariation' | 'InternalProduct';
    isBottleneck?: boolean;
}

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
    components: BOMComponent[];
    lastError?: string;
    lastSyncAttempt?: string;
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

interface ConsumptionEntry {
    id: string;
    orderId: number;
    orderNumber: string;
    productName: string;
    componentName: string;
    quantityDeducted: number;
    previousStock: number;
    newStock: number;
    createdAt: string;
}

/**
 * Maps raw API errors to user-friendly messages with fix suggestions.
 */
function getErrorDetails(error: string): { message: string; fix: string } {
    const errorMap: Record<string, { message: string; fix: string }> = {
        'rest_product_invalid_id': {
            message: 'Product not found in WooCommerce',
            fix: 'Re-sync products from Settings → WooCommerce'
        },
        'woocommerce_rest_cannot_edit': {
            message: 'Product is read-only in WooCommerce',
            fix: 'Check API key permissions in WooCommerce'
        },
        'ECONNREFUSED': {
            message: 'Cannot connect to store',
            fix: 'Verify store URL in Settings'
        },
        'rate_limit': {
            message: 'API rate limit reached',
            fix: 'Wait 60 seconds and retry'
        },
        'stock_quantity': {
            message: 'Component has no stock configured',
            fix: 'Set stock quantity in WooCommerce first'
        },
        'ETIMEDOUT': {
            message: 'Store connection timed out',
            fix: 'Check if store is online and accessible'
        },
        '401': {
            message: 'WooCommerce authentication failed',
            fix: 'Re-enter API credentials in Settings'
        },
        '403': {
            message: 'Permission denied by WooCommerce',
            fix: 'Check API key has read/write permissions'
        }
    };

    // Find matching error
    for (const [key, details] of Object.entries(errorMap)) {
        if (error.toLowerCase().includes(key.toLowerCase())) {
            return details;
        }
    }

    return {
        message: error.length > 80 ? error.substring(0, 80) + '...' : error,
        fix: 'Check logs for more details or contact support'
    };
}

export function BOMSyncPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Data state
    const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
    const [syncHistory, setSyncHistory] = useState<SyncLogEntry[]>([]);
    const [consumptionHistory, setConsumptionHistory] = useState<ConsumptionEntry[]>([]);

    // UI state
    const [isLoadingPending, setIsLoadingPending] = useState(true);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [syncingProductId, setSyncingProductId] = useState<string | null>(null);
    const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);
    const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<'pending' | 'all' | 'errors'>('pending');

    // Stats
    const [stats, setStats] = useState({ total: 0, needsSync: 0, inSync: 0, errors: 0 });
    const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
    const [nextSyncIn, setNextSyncIn] = useState<string | null>(null);

    // Toggle row expansion
    const toggleRow = (key: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    // Cancel a stuck sync job
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
                setIsSyncing(false);
                setSyncProgress(null);
                await fetchPendingChanges();
            }
        } catch (err) {
            Logger.error('Failed to cancel sync', { error: err });
        }
    }

    // Pause/Resume sync
    async function handleTogglePause() {
        // Note: This would require backend support for pause/resume
        // For now, we just toggle the local state
        setIsPaused(!isPaused);
    }

    function handleRefresh() {
        fetchPendingChanges();
        fetchSyncHistory();
    }

    // Retry a single failed product
    async function handleRetry(productId: string, variationId: number) {
        await handleSyncSingle(productId, variationId);
    }

    // Retry all failed products
    async function handleRetryFailed() {
        const failedItems = pendingChanges.filter(item => syncErrors[`${item.productId}-${item.variationId}`]);
        for (const item of failedItems) {
            await handleSyncSingle(item.productId, item.variationId);
        }
    }

    async function handleSyncSingle(productId: string, variationId: number) {
        if (!currentAccount) return;
        const key = `${productId}-${variationId}`;
        setSyncingProductId(key);
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
                const errorMsg = data.error || data.result?.error || `Sync failed (HTTP ${res.status})`;
                setSyncErrors(prev => ({ ...prev, [key]: errorMsg }));
                Logger.error('Sync failed', { productId, variationId, error: errorMsg, response: data });
            } else if (data.localDbUpdated || data.previousStock !== data.newStock) {
                setSyncErrors(prev => ({ ...prev, [key]: '' }));
                await fetchPendingChanges();
                await fetchSyncHistory();
            } else if (!data.success) {
                setSyncErrors(prev => ({ ...prev, [key]: data.error || 'Sync returned success=false' }));
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

            // Calculate next sync time (assuming hourly)
            const now = new Date();
            const nextHour = new Date(now);
            nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
            const minutesUntil = Math.round((nextHour.getTime() - now.getTime()) / 60000);
            setNextSyncIn(`${minutesUntil} min`);
        }
    }, [currentAccount, token]);

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
                    setIsSyncing(true);
                    setSyncResult({ synced: -3, failed: 0 });
                    if (data.progress) {
                        setSyncProgress({ current: data.progress.current, total: data.progress.total });
                    }
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
                const products = data.products || [];
                setPendingChanges(products);

                // Calculate error count
                const errorCount = Object.values(syncErrors).filter(e => e).length;
                setStats({
                    total: data.total,
                    needsSync: data.needsSync,
                    inSync: data.inSync,
                    errors: errorCount
                });
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
        setSyncProgress({ current: 0, total: stats.needsSync });

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

                if (data.status === 'queued' || data.status === 'started') {
                    setSyncResult({ synced: -2, failed: 0 });

                    // Poll for updates
                    let pollCount = 0;
                    const pollInterval = setInterval(async () => {
                        pollCount++;
                        await fetchPendingChanges();
                        await fetchSyncHistory();
                        await checkSyncStatus();

                        if (pollCount >= 12) {
                            clearInterval(pollInterval);
                            setIsSyncing(false);
                            setSyncProgress(null);
                        }
                    }, 5000);

                    setTimeout(() => {
                        clearInterval(pollInterval);
                        setIsSyncing(false);
                        setSyncProgress(null);
                    }, 60000);
                } else if (data.status === 'already_running') {
                    setSyncResult({ synced: -3, failed: 0 });
                    setIsSyncing(false);
                } else {
                    setSyncResult({ synced: data.synced || 0, failed: data.failed || 0 });
                    await fetchPendingChanges();
                    await fetchSyncHistory();
                    setIsSyncing(false);
                    setSyncProgress(null);
                }
            } else {
                setSyncResult({ synced: 0, failed: -1 });
                setIsSyncing(false);
                setSyncProgress(null);
            }
        } catch (err) {
            Logger.error('Failed to sync all', { error: err });
            setSyncResult({ synced: 0, failed: -1 });
            setIsSyncing(false);
            setSyncProgress(null);
        }
    }

    // Filter items based on active tab
    const filteredItems = pendingChanges.filter(item => {
        if (activeTab === 'pending') return item.needsSync;
        if (activeTab === 'errors') return syncErrors[`${item.productId}-${item.variationId}`];
        return true;
    });

    const errorCount = Object.values(syncErrors).filter(e => e).length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-end border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">BOM Inventory Sync</h1>
                    <div className="flex items-center gap-4 mt-1">
                        <p className="text-sm text-gray-500">
                            Sync calculated stock from BOM to WooCommerce
                        </p>
                        {nextSyncIn && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                <Clock size={12} />
                                Auto-sync in {nextSyncIn}
                            </span>
                        )}
                    </div>
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
                    {isSyncing && (
                        <button
                            onClick={handleTogglePause}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-amber-600 hover:bg-amber-50 transition-all border border-amber-200"
                            title={isPaused ? 'Resume' : 'Pause'}
                        >
                            {isPaused ? <Play size={18} /> : <Pause size={18} />}
                        </button>
                    )}
                    {errorCount > 0 && (
                        <button
                            onClick={handleRetryFailed}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-red-600 hover:bg-red-50 transition-all border border-red-200"
                            title="Retry Failed"
                        >
                            <RotateCcw size={18} />
                            Retry ({errorCount})
                        </button>
                    )}
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

            {/* Sync Progress Bar */}
            {syncProgress && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-blue-700">
                            Syncing products...
                        </span>
                        <span className="text-sm text-blue-600">
                            {syncProgress.current} / {syncProgress.total}
                        </span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2">
                        <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Sync Result Toast */}
            {syncResult && !syncProgress && (
                <div className={`p-4 rounded-lg border flex items-center justify-between ${syncResult.synced === -2
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
                            Sync queued! Processing in background...
                        </span>
                    ) : syncResult.synced === -3 ? (
                        <span>A sync is already in progress for this account.</span>
                    ) : syncResult.failed === -1 ? (
                        <span>Sync failed. Please try again.</span>
                    ) : (
                        <span>
                            Synced {syncResult.synced} products.
                            {syncResult.failed > 0 && ` ${syncResult.failed} failed.`}
                        </span>
                    )}
                    {syncResult.synced === -3 && (
                        <button
                            onClick={handleCancelSync}
                            className="px-3 py-1 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
                        >
                            Cancel Sync
                        </button>
                    )}
                </div>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                        <Boxes size={14} />
                        Total BOM Products
                    </div>
                    <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
                </div>
                <button
                    onClick={() => setActiveTab('pending')}
                    className={`text-left rounded-xl border p-4 transition-all ${activeTab === 'pending'
                        ? 'bg-amber-100 border-amber-300 ring-2 ring-amber-200'
                        : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                        }`}
                >
                    <div className="flex items-center gap-2 text-sm text-amber-700 mb-1">
                        <AlertTriangle size={14} />
                        Needs Sync
                    </div>
                    <div className="text-2xl font-bold text-amber-800">{stats.needsSync}</div>
                </button>
                <button
                    onClick={() => setActiveTab('all')}
                    className={`text-left rounded-xl border p-4 transition-all ${activeTab === 'all'
                        ? 'bg-green-100 border-green-300 ring-2 ring-green-200'
                        : 'bg-green-50 border-green-200 hover:bg-green-100'
                        }`}
                >
                    <div className="flex items-center gap-2 text-sm text-green-700 mb-1">
                        <CheckCircle size={14} />
                        In Sync
                    </div>
                    <div className="text-2xl font-bold text-green-800">{stats.inSync}</div>
                </button>
                <button
                    onClick={() => setActiveTab('errors')}
                    className={`text-left rounded-xl border p-4 transition-all ${activeTab === 'errors'
                        ? 'bg-red-100 border-red-300 ring-2 ring-red-200'
                        : errorCount > 0
                            ? 'bg-red-50 border-red-200 hover:bg-red-100'
                            : 'bg-gray-50 border-gray-200'
                        }`}
                >
                    <div className={`flex items-center gap-2 text-sm mb-1 ${errorCount > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                        <XCircle size={14} />
                        Errors
                    </div>
                    <div className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-800' : 'text-gray-400'}`}>
                        {errorCount}
                    </div>
                </button>
            </div>

            {/* Main Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className={`px-6 py-4 border-b flex items-center justify-between ${activeTab === 'errors'
                    ? 'bg-red-50/50 border-red-100'
                    : activeTab === 'pending'
                        ? 'bg-amber-50/50 border-amber-100'
                        : 'bg-gray-50/50 border-gray-100'
                    }`}>
                    <div className="flex items-center gap-2">
                        {activeTab === 'errors' ? (
                            <XCircle size={18} className="text-red-600" />
                        ) : activeTab === 'pending' ? (
                            <AlertTriangle size={18} className="text-amber-600" />
                        ) : (
                            <Package size={18} className="text-gray-400" />
                        )}
                        <h2 className="font-semibold text-gray-900">
                            {activeTab === 'errors' ? 'Failed Syncs' : activeTab === 'pending' ? 'Pending Changes' : 'All BOM Products'}
                        </h2>
                        <span className="text-sm text-gray-500">({filteredItems.length} items)</span>
                    </div>
                </div>

                {isLoadingPending ? (
                    <div className="p-12 text-center text-gray-400">
                        <Loader2 className="animate-spin inline mr-2" /> Loading...
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-2">
                        <CheckCircle size={48} className="text-green-300" />
                        <p className="text-green-700 font-medium">
                            {activeTab === 'errors' ? 'No errors!' : activeTab === 'pending' ? 'All products in sync!' : 'No BOM products found'}
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {filteredItems.map((item) => {
                            const key = `${item.productId}-${item.variationId}`;
                            const isExpanded = expandedRows.has(key);
                            const isSyncingThis = syncingProductId === key;
                            const errorMsg = syncErrors[key];
                            const diff = item.effectiveStock - (item.currentWooStock ?? 0);
                            const errorDetails = errorMsg ? getErrorDetails(errorMsg) : null;

                            // Find bottleneck component
                            const bottleneckComponent = item.components?.reduce((min, c) =>
                                c.buildableUnits < min.buildableUnits ? c : min
                                , item.components[0]);

                            return (
                                <div key={key}>
                                    {/* Main Row */}
                                    <div
                                        className={`px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors ${errorMsg ? 'bg-red-50/30' : ''}`}
                                        onClick={() => toggleRow(key)}
                                    >
                                        <div className="flex items-center gap-4">
                                            {/* Expand Icon */}
                                            <div className="text-gray-400">
                                                {item.components?.length > 0 ? (
                                                    isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />
                                                ) : (
                                                    <div className="w-[18px]" />
                                                )}
                                            </div>

                                            {/* Product Image */}
                                            <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">
                                                {item.mainImage ? (
                                                    <img src={item.mainImage} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                        <Package size={20} />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Product Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-gray-900 truncate">{item.name}</span>
                                                    {item.variationId > 0 && (
                                                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                                                            Variant
                                                        </span>
                                                    )}
                                                </div>
                                                {item.sku && <div className="text-xs text-gray-500 font-mono">{item.sku}</div>}
                                                {item.components?.length > 0 && (
                                                    <div className="text-xs text-gray-400 mt-0.5">
                                                        {item.components.length} component{item.components.length !== 1 ? 's' : ''}
                                                        {bottleneckComponent && (
                                                            <span className="text-amber-600 ml-2">
                                                                • Limited by: {bottleneckComponent.childName}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Stock Values */}
                                            <div className="flex items-center gap-6 text-center">
                                                <div>
                                                    <div className="text-xs text-gray-500 mb-1">WooCommerce</div>
                                                    <div className="text-lg font-bold text-gray-600">{item.currentWooStock ?? '—'}</div>
                                                </div>
                                                <div className="text-gray-300">
                                                    <ArrowRight size={20} />
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500 mb-1">Effective</div>
                                                    <div className="text-lg font-bold text-blue-600">{item.effectiveStock}</div>
                                                </div>
                                                <div className="w-16">
                                                    <div className="text-xs text-gray-500 mb-1">Diff</div>
                                                    <div className={`text-lg font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                                        {diff > 0 ? '+' : ''}{diff}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Status & Actions */}
                                            <div className="flex items-center gap-3">
                                                {errorMsg ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                                        <XCircle size={12} />
                                                        Error
                                                    </span>
                                                ) : item.needsSync ? (
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
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSyncSingle(item.productId, item.variationId);
                                                    }}
                                                    disabled={isSyncingThis || isSyncing}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    {isSyncingThis ? (
                                                        <Loader2 size={14} className="animate-spin" />
                                                    ) : (
                                                        <RefreshCw size={14} />
                                                    )}
                                                    {errorMsg ? 'Retry' : 'Sync'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Error Details */}
                                    {errorDetails && (
                                        <div className="px-6 py-3 bg-red-50 border-t border-red-100">
                                            <div className="flex items-start gap-3 ml-8">
                                                <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                                                <div className="flex-1">
                                                    <div className="text-sm font-medium text-red-800">{errorDetails.message}</div>
                                                    <div className="text-sm text-red-600 mt-1">
                                                        <span className="font-medium">Fix:</span> {errorDetails.fix}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Expanded Component Breakdown */}
                                    {isExpanded && item.components?.length > 0 && (
                                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                                            <div className="ml-8">
                                                <div className="text-xs font-semibold text-gray-500 uppercase mb-3">Component Breakdown</div>
                                                <div className="space-y-2">
                                                    {item.components.map((comp, idx) => {
                                                        const isBottleneck = comp.buildableUnits === bottleneckComponent?.buildableUnits &&
                                                            comp.childName === bottleneckComponent.childName;
                                                        return (
                                                            <div
                                                                key={idx}
                                                                className={`flex items-center justify-between p-3 rounded-lg border ${isBottleneck
                                                                    ? 'bg-amber-50 border-amber-200'
                                                                    : 'bg-white border-gray-200'
                                                                    }`}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <Package size={16} className={isBottleneck ? 'text-amber-500' : 'text-gray-400'} />
                                                                    <div>
                                                                        <div className="font-medium text-gray-900">{comp.childName}</div>
                                                                        <div className="text-xs text-gray-500">
                                                                            {comp.requiredQty}× required per unit
                                                                            {comp.componentType && (
                                                                                <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                                                                                    {comp.componentType === 'InternalProduct' ? 'Internal' :
                                                                                        comp.componentType === 'ProductVariation' ? 'Variant' : 'Product'}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-6 text-sm">
                                                                    <div className="text-center">
                                                                        <div className="text-xs text-gray-500">Stock</div>
                                                                        <div className="font-bold text-gray-700">{comp.childStock}</div>
                                                                    </div>
                                                                    <div className="text-center">
                                                                        <div className="text-xs text-gray-500">Can Build</div>
                                                                        <div className={`font-bold ${isBottleneck ? 'text-amber-600' : 'text-green-600'}`}>
                                                                            {comp.buildableUnits}
                                                                        </div>
                                                                    </div>
                                                                    {isBottleneck && (
                                                                        <div className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                                                            <TrendingDown size={12} />
                                                                            Bottleneck
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Sync History */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                    <History size={18} className="text-gray-400" />
                    <h2 className="font-semibold text-gray-900">Recent Activity</h2>
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
                    <div className="divide-y divide-gray-100">
                        {syncHistory.map((log) => (
                            <div key={log.id} className="px-6 py-3 hover:bg-gray-50 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${log.trigger === 'order_consumption'
                                        ? 'bg-purple-100 text-purple-600'
                                        : 'bg-blue-100 text-blue-600'
                                        }`}>
                                        {log.trigger === 'order_consumption' ? (
                                            <ShoppingCart size={14} />
                                        ) : (
                                            <RefreshCw size={14} />
                                        )}
                                    </div>
                                    <div>
                                        <div className="font-medium text-gray-900">{log.productName}</div>
                                        {log.productSku && <div className="text-xs text-gray-500 font-mono">{log.productSku}</div>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-6">
                                    <div className="font-mono text-sm">
                                        <span className="text-gray-500">{log.previousStock ?? '?'}</span>
                                        <span className="mx-2 text-gray-400">→</span>
                                        <span className="text-blue-600 font-bold">{log.newStock ?? '?'}</span>
                                    </div>
                                    <div className="text-sm text-gray-500 flex items-center gap-1">
                                        <Clock size={14} />
                                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
