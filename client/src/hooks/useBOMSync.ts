/**
 * useBOMSync Hook
 * 
 * Manages BOM sync state, data fetching, and sync operations.
 * Extracted from BOMSyncPage.tsx for reusability and maintainability.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Logger } from '../utils/logger';
import type { DeactivatedItem } from '../components/bom/DeactivatedItemsBanner';

// Types
export interface BOMComponent {
    childName: string;
    requiredQty: number;
    childStock: number;
    buildableUnits: number;
    componentType?: 'WooProduct' | 'ProductVariation' | 'InternalProduct';
    isBottleneck?: boolean;
}

export interface PendingChange {
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

export interface SyncLogEntry {
    id: string;
    productId: string;
    productName: string;
    productSku: string | null;
    previousStock: number | null;
    newStock: number | null;
    trigger: string;
    createdAt: string;
}

export interface ConsumptionEntry {
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

export interface SyncStats {
    total: number;
    needsSync: number;
    inSync: number;
    errors: number;
}

export interface SyncProgress {
    current: number;
    total: number;
}

export interface UseBOMSyncReturn {
    // Data
    pendingChanges: PendingChange[];
    syncHistory: SyncLogEntry[];
    consumptionHistory: ConsumptionEntry[];
    deactivatedItems: DeactivatedItem[];
    stats: SyncStats;

    // Loading states
    isLoadingPending: boolean;
    isLoadingHistory: boolean;
    isSyncing: boolean;
    isPaused: boolean;
    syncingProductId: string | null;

    // Results
    syncResult: { synced: number; failed: number } | null;
    syncErrors: Record<string, string>;
    syncProgress: SyncProgress | null;
    nextSyncIn: string | null;

    // Actions
    handleSyncAll: () => Promise<void>;
    handleSyncSingle: (productId: string, variationId: number) => Promise<void>;
    handleRetryFailed: () => Promise<void>;
    handleCancelSync: () => Promise<void>;
    handleTogglePause: () => void;
    handleRefresh: () => void;
    handleReactivateItem: (itemId: string) => Promise<void>;
    fetchPendingChanges: () => Promise<void>;
    fetchSyncHistory: () => Promise<void>;
}

export function useBOMSync(): UseBOMSyncReturn {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Data state
    const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
    const [syncHistory, setSyncHistory] = useState<SyncLogEntry[]>([]);
    const [consumptionHistory, setConsumptionHistory] = useState<ConsumptionEntry[]>([]);
    const [deactivatedItems, setDeactivatedItems] = useState<DeactivatedItem[]>([]);

    // UI state
    const [isLoadingPending, setIsLoadingPending] = useState(true);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [syncingProductId, setSyncingProductId] = useState<string | null>(null);
    const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);
    const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
    /** Ref to break the fetchPendingChanges → syncErrors → useEffect loop */
    const syncErrorsRef = useRef(syncErrors);
    syncErrorsRef.current = syncErrors;

    /** Ref for isPaused so the polling closure always reads the latest value */
    const isPausedRef = useRef(isPaused);
    isPausedRef.current = isPaused;

    /** Track polling interval/timeout so we can clean up on unmount or re-invocation */
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Stats and progress
    const [stats, setStats] = useState<SyncStats>({ total: 0, needsSync: 0, inSync: 0, errors: 0 });
    const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
    const [nextSyncIn, setNextSyncIn] = useState<string | null>(null);

    const fetchPendingChanges = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsLoadingPending(true);
        try {
            const res = await fetch('/api/inventory/bom/pending-changes', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                const products = data.products || [];
                setPendingChanges(products);

                // Read from ref to avoid adding syncErrors to deps (prevents infinite loop)
                const errorCount = Object.values(syncErrorsRef.current).filter(e => e).length;
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
    }, [currentAccount?.id, token]);

    const fetchSyncHistory = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsLoadingHistory(true);
        try {
            const res = await fetch('/api/inventory/bom/sync-history?limit=20', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
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
    }, [currentAccount?.id, token]);

    /** Fetch BOM consumption history (deduction ledger entries) */
    const fetchConsumptionHistory = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch('/api/inventory/bom/consumption-history?limit=50', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setConsumptionHistory(data.entries || []);
            }
        } catch (err) {
            Logger.error('Failed to fetch consumption history', { error: err });
        }
    }, [currentAccount?.id, token]);

    const checkSyncStatus = useCallback(async () => {
        if (!currentAccount || !token) return;
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
    }, [currentAccount?.id, token]);

    const handleSyncSingle = useCallback(async (productId: string, variationId: number) => {
        if (!currentAccount || !token) return;
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
                Logger.error('Sync failed', { productId, variationId, error: errorMsg });
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
    }, [currentAccount?.id, token, fetchPendingChanges, fetchSyncHistory]);

    const handleSyncAll = useCallback(async () => {
        if (!currentAccount || !token) return;

        // Clean up any existing poll from a previous invocation
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);

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

                    let pollCount = 0;
                    pollIntervalRef.current = setInterval(async () => {
                        // Why ref: the closure captures stale isPaused, ref always has latest
                        if (isPausedRef.current) return;
                        pollCount++;
                        await fetchPendingChanges();
                        await fetchSyncHistory();
                        await checkSyncStatus();

                        if (pollCount >= 12) {
                            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                            pollIntervalRef.current = null;
                            setIsSyncing(false);
                            setSyncProgress(null);
                        }
                    }, 5000);

                    pollTimeoutRef.current = setTimeout(() => {
                        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                        pollTimeoutRef.current = null;
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
    }, [currentAccount?.id, token, stats.needsSync, fetchPendingChanges, fetchSyncHistory, checkSyncStatus]);

    const handleRetryFailed = useCallback(async () => {
        const failedItems = pendingChanges.filter(item => syncErrors[`${item.productId}-${item.variationId}`]);
        for (const item of failedItems) {
            await handleSyncSingle(item.productId, item.variationId);
        }
    }, [pendingChanges, syncErrors, handleSyncSingle]);

    const handleCancelSync = useCallback(async () => {
        if (!currentAccount || !token) return;
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
    }, [currentAccount?.id, token, fetchPendingChanges]);

    const handleTogglePause = useCallback(() => {
        setIsPaused(prev => !prev);
    }, []);

    /** Fetch deactivated BOM items for the banner */
    const fetchDeactivatedItems = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch('/api/inventory/bom/deactivated-items', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setDeactivatedItems(data.items || []);
            }
        } catch (err) {
            Logger.error('Failed to fetch deactivated items', { error: err });
        }
    }, [currentAccount?.id, token]);

    const handleRefresh = useCallback(() => {
        fetchPendingChanges();
        fetchSyncHistory();
        fetchConsumptionHistory();
        fetchDeactivatedItems();
    }, [fetchPendingChanges, fetchSyncHistory, fetchConsumptionHistory, fetchDeactivatedItems]);

    /** Reactivate a single deactivated item, then refresh the list */
    const handleReactivateItem = useCallback(async (itemId: string) => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch(`/api/inventory/bom/items/${itemId}/reactivate`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                await fetchDeactivatedItems();
                await fetchPendingChanges();
            }
        } catch (err) {
            Logger.error('Failed to reactivate BOM item', { error: err });
        }
    }, [currentAccount?.id, token, fetchDeactivatedItems, fetchPendingChanges]);

    // Initial fetch — only run when account or token changes
    useEffect(() => {
        if (currentAccount && token) {
            fetchPendingChanges();
            fetchSyncHistory();
            fetchConsumptionHistory();
            fetchDeactivatedItems();
            checkSyncStatus();

            // Calculate next sync time (assuming hourly)
            const now = new Date();
            const nextHour = new Date(now);
            nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
            const minutesUntil = Math.round((nextHour.getTime() - now.getTime()) / 60000);
            setNextSyncIn(`${minutesUntil} min`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentAccount?.id, token]);

    // Cleanup polling on unmount to prevent setState on unmounted component
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        };
    }, []);

    return {
        pendingChanges,
        syncHistory,
        consumptionHistory,
        deactivatedItems,
        stats,
        isLoadingPending,
        isLoadingHistory,
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
        fetchPendingChanges,
        fetchSyncHistory,
    };
}

/**
 * Maps raw API errors to user-friendly messages with fix suggestions.
 */
export function getErrorDetails(error: string): { message: string; fix: string } {
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
