/**
 * BOM Inventory Sync Dashboard
 * 
 * Shows pending BOM inventory changes, sync queue control, and consumption history.
 * 
 * Modular components:
 * - useBOMSync: State management and API operations
 * - SyncStatsCards: Statistics display cards
 * - SyncProductRow: Individual product row with component breakdown
 */

import { useState } from 'react';
import {
    RefreshCw,
    Package,
    Loader2,
    CheckCircle,
    AlertTriangle,
    Clock,
    RotateCcw,
    Pause,
    Play,
    XCircle
} from 'lucide-react';
import { useBOMSync } from '../hooks/useBOMSync';
import { SyncStatsCards } from '../components/bom/SyncStatsCards';
import { SyncProductRow } from '../components/bom/SyncProductRow';
import { DeactivatedItemsBanner } from '../components/bom/DeactivatedItemsBanner';

export function BOMSyncPage() {
    const {
        pendingChanges,
        deactivatedItems,
        stats,
        isLoadingPending,
        isSyncing,
        isPaused,
        syncingProductId,
        syncResult,
        syncErrors,
        syncProgress,
        nextSyncIn,
        handleSyncAll,
        handleSyncSingle,
        handleRetryFailed,
        handleCancelSync,
        handleTogglePause,
        handleRefresh,
        handleReactivateItem,
    } = useBOMSync();

    // Local UI state
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<'pending' | 'all' | 'errors'>('pending');

    const errorCount = Object.values(syncErrors).filter(e => e).length;

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

    // Filter items based on active tab
    const filteredItems = pendingChanges.filter(item => {
        if (activeTab === 'pending') return item.needsSync;
        if (activeTab === 'errors') return syncErrors[`${item.productId}-${item.variationId}`];
        return true;
    });

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
                <SyncResultToast
                    syncResult={syncResult}
                    onCancelSync={handleCancelSync}
                />
            )}

            {/* Deactivated Items Banner */}
            <DeactivatedItemsBanner
                items={deactivatedItems}
                onReactivate={handleReactivateItem}
            />

            {/* Stats Cards */}
            <SyncStatsCards
                stats={stats}
                errorCount={errorCount}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />

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
                            return (
                                <SyncProductRow
                                    key={key}
                                    item={item}
                                    isExpanded={expandedRows.has(key)}
                                    isSyncingThis={syncingProductId === key}
                                    isSyncingAll={isSyncing}
                                    errorMsg={syncErrors[key] || null}
                                    onToggleExpand={() => toggleRow(key)}
                                    onSync={() => handleSyncSingle(item.productId, item.variationId)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Displays sync result notifications
 */
interface SyncResultToastProps {
    syncResult: { synced: number; failed: number };
    onCancelSync: () => void;
}

function SyncResultToast({ syncResult, onCancelSync }: SyncResultToastProps) {
    const getToastStyle = () => {
        if (syncResult.synced === -2) return 'bg-blue-50 border-blue-200 text-blue-800';
        if (syncResult.synced === -3) return 'bg-amber-50 border-amber-200 text-amber-800';
        if (syncResult.failed === 0 && syncResult.synced >= 0) return 'bg-green-50 border-green-200 text-green-800';
        if (syncResult.failed === -1) return 'bg-red-50 border-red-200 text-red-800';
        return 'bg-amber-50 border-amber-200 text-amber-800';
    };

    const getMessage = () => {
        if (syncResult.synced === -2) {
            return (
                <span className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Sync queued! Processing in background...
                </span>
            );
        }
        if (syncResult.synced === -3) {
            return <span>A sync is already in progress for this account.</span>;
        }
        if (syncResult.failed === -1) {
            return <span>Sync failed. Please try again.</span>;
        }
        return (
            <span>
                Synced {syncResult.synced} products.
                {syncResult.failed > 0 && ` ${syncResult.failed} failed.`}
            </span>
        );
    };

    return (
        <div className={`p-4 rounded-lg border flex items-center justify-between ${getToastStyle()}`}>
            {getMessage()}
            {syncResult.synced === -3 && (
                <button
                    onClick={onCancelSync}
                    className="px-3 py-1 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
                >
                    Cancel Sync
                </button>
            )}
        </div>
    );
}
