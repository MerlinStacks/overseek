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

export interface SyncStats {
    total: number;
    needsSync: number;
    inSync: number;
    errors: number;
}

interface SyncProgress {
    current: number;
    total: number;
}

interface UseBOMSyncReturn {
    // Data
    pendingChanges: PendingChange[];
    deactivatedItems: DeactivatedItem[];
    stats: SyncStats;

    // Loading states
    isLoadingPending: boolean;
    loadError: string | null;
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
}

export function useBOMSync(): UseBOMSyncReturn {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;

    // Data state
    const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
    const [deactivatedItems, setDeactivatedItems] = useState<DeactivatedItem[]>([]);

    // UI state
    const [isLoadingPending, setIsLoadingPending] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [syncingProductId, setSyncingProductId] = useState<string | null>(null);
    const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);
    const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
    /** Ref to break the fetchPendingChanges -> syncErrors -> useEffect loop */
    const syncErrorsRef = useRef(syncErrors);
    syncErrorsRef.current = syncErrors;

    /** Ref for isPaused so the polling closure always reads the latest value */
    const isPausedRef = useRef(isPaused);
    isPausedRef.current = isPaused;

    // Every request belongs to one account/auth lifecycle, including follow-up work.
    const lifecycleRef = useRef<{ accountId: string; token: string; controller: AbortController } | null>(null);
    const getSignal = useCallback(() => {
        const lifecycle = lifecycleRef.current;
        return lifecycle?.accountId === accountId && lifecycle?.token === token
            && !lifecycle.controller.signal.aborted ? lifecycle.controller.signal : null;
    }, [accountId, token]);
    const previewRequestRef = useRef<Promise<void> | null>(null);
    const statusRequestRef = useRef<Promise<void> | null>(null);
    const runningRef = useRef(false);
    const startingRef = useRef(false);
    const statusVersionRef = useRef(0);

    // Stats and progress
    const [stats, setStats] = useState<SyncStats>({ total: 0, needsSync: 0, inSync: 0, errors: 0 });
    /** Why ref: handleSyncAll captures stats in its closure; without a ref
     *  the progress bar total would be stale if stats changed between click
     *  and execution. */
    const statsRef = useRef(stats);
    statsRef.current = stats;
    const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);

    const extractBomApiError = (data: unknown, fallback: string): { message: string; code: string | null } => {
        if (!data || typeof data !== 'object') return { message: fallback, code: null };
        const payload = data as { error?: unknown; code?: unknown; result?: { error?: unknown; code?: unknown } };
        const code = typeof payload.code === 'string'
            ? payload.code
            : (typeof payload.result?.code === 'string' ? payload.result.code : null);
        const error = typeof payload.error === 'string'
            ? payload.error
            : (typeof payload.result?.error === 'string' ? payload.result.error : fallback);
        return { message: error, code };
    };

    const fetchPendingChanges = useCallback(async () => {
        const signal = getSignal();
        if (!signal || !accountId) return;
        if (previewRequestRef.current) return previewRequestRef.current;
        setIsLoadingPending(true);
        const request = (async () => {
            try {
                const res = await fetch('/api/inventory/bom/pending-changes', {
                    signal,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': accountId
                    }
                });
                if (!res.ok) throw new Error(`Failed to load BOM preview (HTTP ${res.status})`);
                const data = await res.json();
                if (signal.aborted) return;
                const products = data.products || [];
                setPendingChanges(products);
                setLoadError(null);

                // Read from ref to avoid adding syncErrors to deps (prevents infinite loop)
                const errorCount = Object.values(syncErrorsRef.current).filter(e => e).length;
                setStats({
                    total: data.total,
                    needsSync: data.needsSync,
                    inSync: data.inSync,
                    errors: errorCount
                });
            } catch (err) {
                if (signal.aborted) return;
                setLoadError(err instanceof Error ? err.message : 'Failed to load BOM preview');
                Logger.error('Failed to fetch pending changes', { error: err });
            } finally {
                if (!signal.aborted) setIsLoadingPending(false);
            }
        })();
        previewRequestRef.current = request;
        try { await request; } finally {
            if (previewRequestRef.current === request) previewRequestRef.current = null;
        }
    }, [accountId, token, getSignal]);

    const checkSyncStatus = useCallback(async () => {
        const signal = getSignal();
        if (!signal || !accountId) return;
        if (statusRequestRef.current) return statusRequestRef.current;
        const version = statusVersionRef.current;
        const request = (async () => {
            try {
                const res = await fetch('/api/inventory/bom/sync-status', {
                    signal,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': accountId
                    }
                });
                if (!res.ok) throw new Error(`Failed to check sync status (HTTP ${res.status})`);
                const data = await res.json();
                if (signal.aborted || version !== statusVersionRef.current) return;
                if (data.isSyncing) {
                    runningRef.current = true;
                    setIsSyncing(true);
                    setSyncResult({ synced: -3, failed: 0 });
                    if (data.progress) {
                        setSyncProgress({ current: data.progress.current, total: data.progress.total });
                    }
                } else {
                    const completed = runningRef.current;
                    runningRef.current = false;
                    setIsSyncing(false);
                    setSyncProgress(null);
                    if (completed) {
                        setSyncResult(null);
                        // A preview already in flight may predate completion.
                        await previewRequestRef.current;
                        if (!signal.aborted) await fetchPendingChanges();
                    }
                }
            } catch (err) {
                if (!signal.aborted) Logger.error('Failed to check sync status', { error: err });
            }
        })();
        statusRequestRef.current = request;
        try { await request; } finally {
            if (statusRequestRef.current === request) statusRequestRef.current = null;
        }
    }, [accountId, token, getSignal, fetchPendingChanges]);

    const handleSyncSingle = useCallback(async (productId: string, variationId: number, refresh = true) => {
        const signal = getSignal();
        if (!signal || !accountId) return;
        const key = `${productId}-${variationId}`;
        setSyncingProductId(key);
        setSyncErrors(prev => ({ ...prev, [key]: '' }));

        try {
            const res = await fetch(`/api/inventory/products/${productId}/bom/sync?variationId=${variationId}`, {
                signal,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': accountId
                }
            });
            const data = await res.json();
            if (signal.aborted) return;

            if (!res.ok) {
                const parsedError = extractBomApiError(data, `Sync failed (HTTP ${res.status})`);
                const errorMsg = parsedError.message;
                setSyncErrors(prev => ({ ...prev, [key]: errorMsg }));
                Logger.error('Sync failed', { productId, variationId, code: parsedError.code, error: errorMsg });
            } else if (data.localDbUpdated || data.previousStock !== data.newStock) {
                setSyncErrors(prev => ({ ...prev, [key]: '' }));
                if (refresh) await fetchPendingChanges();
            } else if (!data.success) {
                const parsedError = extractBomApiError(data, 'Sync returned success=false');
                setSyncErrors(prev => ({ ...prev, [key]: parsedError.message }));
            }
        } catch (err: unknown) {
            if (signal.aborted) return;
            const errorMsg = err instanceof Error ? err.message : 'Network error';
            setSyncErrors(prev => ({ ...prev, [key]: errorMsg }));
            Logger.error('Failed to sync single product', { error: err });
        } finally {
            if (!signal.aborted) setSyncingProductId(null);
        }
    }, [accountId, token, getSignal, fetchPendingChanges]);

    const handleSyncAll = useCallback(async () => {
        const signal = getSignal();
        if (!signal || !accountId || runningRef.current) return;
        runningRef.current = true;
        startingRef.current = true;
        statusVersionRef.current++;

        setIsSyncing(true);
        setSyncResult(null);
        setSyncProgress({ current: 0, total: statsRef.current.needsSync });

        try {
            const res = await fetch('/api/inventory/bom/sync-all', {
                signal,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': accountId
                },
                body: JSON.stringify({})
            });

            if (signal.aborted) return;
            if (res.ok) {
                const data = await res.json();
                if (signal.aborted) return;

                if (['queued', 'started', 'already_running'].includes(data.status)) {
                    setIsSyncing(true);
                    setSyncResult({ synced: data.status === 'already_running' ? -3 : -2, failed: 0 });
                } else {
                    runningRef.current = false;
                    setSyncResult({ synced: data.synced || 0, failed: data.failed || 0 });
                    await fetchPendingChanges();
                    if (signal.aborted) return;
                    setIsSyncing(false);
                    setSyncProgress(null);
                }
            } else {
                runningRef.current = false;
                setSyncResult({ synced: 0, failed: -1 });
                setIsSyncing(false);
                setSyncProgress(null);
            }
        } catch (err) {
            if (signal.aborted) return;
            runningRef.current = false;
            Logger.error('Failed to sync all', { error: err });
            setSyncResult({ synced: 0, failed: -1 });
            setIsSyncing(false);
            setSyncProgress(null);
        } finally {
            if (!signal.aborted) startingRef.current = false;
        }
    }, [accountId, token, getSignal, fetchPendingChanges]);

    const handleRetryFailed = useCallback(async () => {
        const signal = getSignal();
        if (!signal) return;
        const failedItems = pendingChanges.filter(item => syncErrors[`${item.productId}-${item.variationId}`]);
        for (const item of failedItems) {
            if (signal.aborted) return;
            await handleSyncSingle(item.productId, item.variationId, false);
        }
        if (failedItems.length && !signal.aborted) await fetchPendingChanges();
    }, [pendingChanges, syncErrors, handleSyncSingle, getSignal, fetchPendingChanges]);

    const handleCancelSync = useCallback(async () => {
        const signal = getSignal();
        if (!signal || !accountId) return;
        try {
            const res = await fetch('/api/inventory/bom/sync-cancel', {
                signal,
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': accountId
                }
            });
            if (signal.aborted) return;
            if (res.ok) {
                statusVersionRef.current++;
                runningRef.current = false;
                setSyncResult(null);
                setIsSyncing(false);
                setSyncProgress(null);
                await fetchPendingChanges();
            }
        } catch (err) {
            if (!signal.aborted) Logger.error('Failed to cancel sync', { error: err });
        }
    }, [accountId, token, getSignal, fetchPendingChanges]);

    const handleTogglePause = useCallback(() => {
        setIsPaused(prev => !prev);
    }, []);

    /** Fetch deactivated BOM items for the banner */
    const fetchDeactivatedItems = useCallback(async () => {
        const signal = getSignal();
        if (!signal || !accountId) return;
        try {
            const res = await fetch('/api/inventory/bom/deactivated-items', {
                signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': accountId
                }
            });
            if (res.ok) {
                const data = await res.json();
                if (signal.aborted) return;
                setDeactivatedItems(data.items || []);
            }
        } catch (err) {
            if (!signal.aborted) Logger.error('Failed to fetch deactivated items', { error: err });
        }
    }, [accountId, token, getSignal]);

    const handleRefresh = useCallback(() => {
        fetchPendingChanges();
        fetchDeactivatedItems();
    }, [fetchPendingChanges, fetchDeactivatedItems]);

    /** Reactivate a single deactivated item, then refresh the list */
    const handleReactivateItem = useCallback(async (itemId: string) => {
        const signal = getSignal();
        if (!signal || !accountId) return;
        try {
            const res = await fetch(`/api/inventory/bom/items/${itemId}/reactivate`, {
                signal,
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': accountId
                }
            });
            if (signal.aborted) return;
            if (res.ok) {
                await fetchDeactivatedItems();
                if (!signal.aborted) await fetchPendingChanges();
            }
        } catch (err) {
            if (!signal.aborted) Logger.error('Failed to reactivate BOM item', { error: err });
        }
    }, [accountId, token, getSignal, fetchDeactivatedItems, fetchPendingChanges]);

    useEffect(() => {
        const controller = new AbortController();
        lifecycleRef.current = accountId && token ? { accountId, token, controller } : null;
        previewRequestRef.current = null;
        statusRequestRef.current = null;
        runningRef.current = false;
        startingRef.current = false;
        statusVersionRef.current++;
        setPendingChanges([]);
        setDeactivatedItems([]);
        setStats({ total: 0, needsSync: 0, inSync: 0, errors: 0 });
        setLoadError(null);
        setIsLoadingPending(Boolean(accountId && token));
        setIsSyncing(false);
        setIsPaused(false);
        setSyncingProductId(null);
        setSyncResult(null);
        setSyncErrors({});
        syncErrorsRef.current = {};
        setSyncProgress(null);
        if (accountId && token) {
            fetchPendingChanges();
            fetchDeactivatedItems();
            checkSyncStatus();

        }
        return () => controller.abort();
    }, [accountId, token, fetchPendingChanges, fetchDeactivatedItems, checkSyncStatus]);

    // Schedule after each response, so slow status requests never overlap.
    useEffect(() => {
        if (!isSyncing) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            if (!isPausedRef.current && !startingRef.current) await checkSyncStatus();
            if (!stopped) timer = setTimeout(poll, 5000);
        };
        timer = setTimeout(poll, 5000);
        return () => { stopped = true; clearTimeout(timer); };
    }, [isSyncing, checkSyncStatus]);

    return {
        pendingChanges,
        deactivatedItems,
        stats,
        isLoadingPending,
        loadError,
        isSyncing,
        isPaused,
        syncingProductId,
        syncResult,
        syncErrors,
        syncProgress,
        nextSyncIn: null,
        handleSyncAll,
        handleSyncSingle,
        handleRetryFailed,
        handleCancelSync,
        handleTogglePause,
        handleRefresh,
        handleReactivateItem,
        fetchPendingChanges,
    };
}

/**
 * Maps raw API errors to user-friendly messages with fix suggestions.
 */
export function getErrorDetails(error: string): { message: string; fix: string } {
    const errorMap: Record<string, { message: string; fix: string }> = {
        'BOM_SYNC_FAILED': {
            message: 'BOM sync request was rejected',
            fix: 'Open BOM for this product and confirm all components are valid'
        },
        'BOM_SYNC_EXCEPTION': {
            message: 'BOM sync failed on the server',
            fix: 'Retry in a moment; if it repeats, check server logs'
        },
        'INVALID_VARIATION_ID': {
            message: 'Invalid variation selected for sync',
            fix: 'Refresh the page and reselect the product variation'
        },
        'PRODUCT_NOT_FOUND': {
            message: 'Product no longer exists in this account',
            fix: 'Re-sync products from WooCommerce and try again'
        },
        'BOM_COMPONENT_OWNERSHIP_INVALID': {
            message: 'One or more BOM components are not available in this account',
            fix: 'Remove invalid components and re-add valid mapped items'
        },
        'rest_product_invalid_id': {
            message: 'Product not found in WooCommerce',
            fix: 'Re-sync products from Settings -> WooCommerce'
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
