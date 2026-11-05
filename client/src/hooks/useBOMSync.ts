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
    childProductId?: string;
    childWooId?: number;
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

interface SyncError {
    message: string;
    code: string | null;
}

export interface BOMRecoveryPlan {
    fingerprint: string;
    sourceJobIds: string[];
    eligibleProducts: number;
    uncertainProducts: number;
    excludedProducts: number;
}
export interface BOMRepairSummary {
    total: number;
    checked: number;
    repaired: number;
    unchanged: number;
    failed: number;
    verified: boolean;
}

const reconciliationCode = 'BOM_SYNC_RECONCILIATION_REQUIRED';
const reconciliationMessage = 'A previous BOM run failed or stalled. Use Repair & resume to verify fresh stock and repair mismatches automatically. An inventory operator is only needed when the previous worker’s pending writes cannot be confirmed stopped.';

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
    syncError: SyncError | null;
    recoveryPlan: BOMRecoveryPlan | null;
    recoveryError: string | null;
    isLoadingRecovery: boolean;
    isRecovering: boolean;
    isRepairing: boolean;
    repairSummary: BOMRepairSummary | null;
    syncProgress: SyncProgress | null;
    nextSyncIn: string | null;

    // Actions
    handleSyncAll: () => Promise<void>;
    handleReviewRecovery: () => Promise<void>;
    handleContinueRecovery: () => Promise<void>;
    handleRepair: (fingerprint: string, confirmedStoppedAndSettled: boolean) => Promise<void>;
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
    const [syncError, setSyncError] = useState<SyncError | null>(null);
    const [recoveryPlan, setRecoveryPlan] = useState<BOMRecoveryPlan | null>(null);
    const [recoveryError, setRecoveryError] = useState<string | null>(null);
    const [isLoadingRecovery, setIsLoadingRecovery] = useState(false);
    const [isRecovering, setIsRecovering] = useState(false);
    const [isRepairing, setIsRepairing] = useState(false);
    const [repairSummary, setRepairSummary] = useState<BOMRepairSummary | null>(null);
    const recoveryRequestRef = useRef<AbortSignal | null>(null);
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
    const singleSyncRef = useRef<AbortSignal | null>(null);
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
                setRepairSummary(data.repairSummary ?? null);
                if (data.isSyncing) {
                    setIsRepairing(data.isRepair === true);
                    setIsRecovering(data.isRecovery === true);
                    setRecoveryPlan(null);
                    setSyncError(null);
                    runningRef.current = true;
                    setIsSyncing(true);
                    setSyncResult({ synced: -3, failed: 0 });
                    if (data.progress) {
                        setSyncProgress({ current: data.progress.current, total: data.progress.total });
                    }
                } else {
                    setIsRepairing(false);
                    setIsRecovering(false);
                    if (data.requiresReconciliation || data.code === reconciliationCode) {
                        setSyncError({ message: reconciliationMessage, code: reconciliationCode });
                        setSyncResult(null);
                    } else {
                        setSyncError(previous => previous?.code === reconciliationCode ? null : previous);
                    }
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
        if (!signal || !accountId || singleSyncRef.current === signal || runningRef.current || syncError?.code === reconciliationCode || typeof productId !== 'string' || !productId || !Number.isInteger(variationId) || variationId < 0 || variationId > 2147483647) return;
        singleSyncRef.current = signal;
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
            } else if (data.success === true) {
                setSyncErrors(prev => ({ ...prev, [key]: '' }));
                if (refresh) await fetchPendingChanges();
            } else {
                const parsedError = extractBomApiError(data, 'Sync returned success=false');
                setSyncErrors(prev => ({ ...prev, [key]: parsedError.message }));
            }
        } catch (err: unknown) {
            if (signal.aborted) return;
            const errorMsg = err instanceof Error ? err.message : 'Network error';
            setSyncErrors(prev => ({ ...prev, [key]: errorMsg }));
            Logger.error('Failed to sync single product', { error: err });
        } finally {
            if (singleSyncRef.current === signal) singleSyncRef.current = null;
            if (!signal.aborted) setSyncingProductId(null);
        }
    }, [accountId, token, getSignal, fetchPendingChanges, syncError]);

    const handleSyncAll = useCallback(async () => {
        const signal = getSignal();
        if (!signal || !accountId || runningRef.current || singleSyncRef.current === signal || syncError?.code === reconciliationCode) return;
        runningRef.current = true;
        startingRef.current = true;
        statusVersionRef.current++;

        setIsSyncing(true);
        setSyncError(null);
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
                const data = await res.json().catch(() => null);
                if (signal.aborted) return;
                const error = extractBomApiError(data, `Failed to start BOM sync (HTTP ${res.status}).`);
                setSyncError(error.code === reconciliationCode ? { message: reconciliationMessage, code: error.code } : error);
                runningRef.current = false;
                setSyncResult(null);
                setIsSyncing(false);
                setSyncProgress(null);
            }
        } catch (err) {
            if (signal.aborted) return;
            runningRef.current = false;
            Logger.error('Failed to sync all', { error: err });
            setSyncError({ message: err instanceof Error ? err.message : 'Failed to start BOM sync. Check your connection and refresh the sync status.', code: null });
            setSyncResult(null);
            setIsSyncing(false);
            setSyncProgress(null);
        } finally {
            if (!signal.aborted) startingRef.current = false;
        }
    }, [accountId, token, getSignal, fetchPendingChanges, syncError]);

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

    const handleReviewRecovery = useCallback(async () => {
        const signal = getSignal();
        if (!signal || !accountId || runningRef.current || recoveryRequestRef.current === signal) return;
        recoveryRequestRef.current = signal;
        setIsLoadingRecovery(true);
        setRecoveryPlan(null);
        setRecoveryError(null);
        try {
            const res = await fetch('/api/inventory/bom/sync-recovery', {
                signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId }
            });
            const data = await res.json();
            if (signal.aborted) return;
            if (!res.ok) throw new Error(extractBomApiError(data, 'Could not inspect the failed run.').message);
            if (!/^[a-f0-9]{64}$/.test(data.fingerprint) || !Array.isArray(data.sourceJobIds)
                || !['eligibleProducts', 'uncertainProducts', 'excludedProducts'].every(key => Number.isInteger(data[key]) && data[key] >= 0 && data[key] <= 10000)) {
                throw new Error('Invalid recovery plan. Refresh before continuing.');
            }
            setRecoveryPlan(data);
        } catch (error) {
            if (!signal.aborted) setRecoveryError(error instanceof Error ? error.message : 'Could not inspect the failed run.');
        } finally {
            if (recoveryRequestRef.current === signal) recoveryRequestRef.current = null;
            if (!signal.aborted) setIsLoadingRecovery(false);
        }
    }, [accountId, token, getSignal]);

    const handleRepair = useCallback(async (fingerprint: string, confirmedStoppedAndSettled: boolean) => {
        const signal = getSignal();
        if (!signal || !accountId || runningRef.current || singleSyncRef.current === signal) return;
        runningRef.current = true; startingRef.current = true; statusVersionRef.current++;
        setIsSyncing(true); setIsRepairing(true); setSyncResult(null); setRepairSummary(null);
        setSyncProgress({ current: 0, total: statsRef.current.total });
        try {
            const res = await fetch('/api/inventory/bom/sync-repair', {
                signal, method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fingerprint, confirmedStoppedAndSettled })
            });
            const data = await res.json();
            if (signal.aborted) return;
            if (!res.ok || data.status !== 'queued') throw new Error(extractBomApiError(data, 'Repair was not acknowledged. Refresh sync status before retrying.').message);
            runningRef.current = true; setIsSyncing(true);
            setSyncError(null); setRecoveryPlan(null); setSyncResult({ synced: -2, failed: 0 });
        } catch (error) {
            if (signal.aborted) return;
            // A lost response may follow admission. Only status may release the
            // local write guard; if unavailable, keep polling instead of guessing.
            await checkSyncStatus();
            throw error;
        } finally {
            if (!signal.aborted) startingRef.current = false;
        }
    }, [accountId, token, getSignal, checkSyncStatus]);

    const handleContinueRecovery = useCallback(async () => {
        const signal = getSignal();
        if (!signal || !accountId || !recoveryPlan || recoveryPlan.eligibleProducts === 0 || runningRef.current || singleSyncRef.current === signal) return;
        runningRef.current = true;
        startingRef.current = true;
        statusVersionRef.current++;
        setIsSyncing(true);
        setRecoveryError(null);
        try {
            const res = await fetch('/api/inventory/bom/sync-recovery', {
                signal, method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fingerprint: recoveryPlan.fingerprint, confirmedStoppedAndSettled: true })
            });
            const data = await res.json();
            if (signal.aborted) return;
            if (!res.ok) throw new Error(extractBomApiError(data, 'Continuation was not acknowledged. Refresh sync status before retrying.').message);
            if (['queued', 'already_running'].includes(data.status)) {
                setIsRecovering(true);
                setSyncError(null);
                setRecoveryPlan(null);
                setSyncProgress({ current: 0, total: recoveryPlan.eligibleProducts });
                setSyncResult({ synced: -2, failed: 0 });
            } else {
                runningRef.current = false;
                setIsSyncing(false);
                setRecoveryPlan(null);
                await checkSyncStatus();
            }
        } catch (error) {
            if (signal.aborted) return;
            setRecoveryError(error instanceof Error ? error.message : 'Continuation was not acknowledged. Refresh sync status before retrying.');
            // A lost response may follow successful queue admission. Keep writes
            // blocked and polling alive until an authoritative status is available.
            await checkSyncStatus();
        } finally {
            if (!signal.aborted) startingRef.current = false;
        }
    }, [accountId, token, getSignal, recoveryPlan, checkSyncStatus]);

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
            const items: DeactivatedItem[] = []; const seen = new Set<string>(); let cursor: string | null = null;
            for (let page = 0; page < 50; page++) {
            const res: Response = await fetch(`/api/inventory/bom/deactivated-items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
                signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': accountId
                }
            });
            if (res.ok) {
                const data: { items: DeactivatedItem[]; nextCursor?: unknown } = await res.json();
                if (signal.aborted) return;
                if (!Array.isArray(data.items) || data.items.length > 200) throw new Error('Invalid deactivated component page');
                items.push(...data.items);
                if (!data.nextCursor) { setDeactivatedItems(items); return; }
                if (typeof data.nextCursor !== 'string' || seen.has(data.nextCursor)) throw new Error('Invalid component cursor');
                seen.add(data.nextCursor); cursor = data.nextCursor;
            } else throw new Error('Could not load deactivated components');
            }
            throw new Error('Deactivated component list exceeds the display limit');
        } catch (err) {
            if (!signal.aborted) setLoadError('Deactivated components could not be fully loaded. Refresh before using this list.');
            if (!signal.aborted) Logger.error('Failed to fetch deactivated items', { error: err });
        }
    }, [accountId, token, getSignal]);

    const handleRefresh = useCallback(() => {
        fetchPendingChanges();
        fetchDeactivatedItems();
        checkSyncStatus();
    }, [fetchPendingChanges, fetchDeactivatedItems, checkSyncStatus]);

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
            if (!res.ok) throw new Error('Failed to reactivate BOM item');
            if (res.ok) {
                await fetchDeactivatedItems();
                if (!signal.aborted) await fetchPendingChanges();
            }
        } catch (err) {
            if (!signal.aborted) { Logger.error('Failed to reactivate BOM item', { error: err }); throw err; }
        }
    }, [accountId, token, getSignal, fetchDeactivatedItems, fetchPendingChanges]);

    useEffect(() => {
        const controller = new AbortController();
        lifecycleRef.current = accountId && token ? { accountId, token, controller } : null;
        previewRequestRef.current = null;
        statusRequestRef.current = null;
        runningRef.current = false;
        startingRef.current = false;
        singleSyncRef.current = null;
        recoveryRequestRef.current = null;
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
        setSyncError(null);
        setRecoveryPlan(null);
        setRecoveryError(null);
        setIsLoadingRecovery(false);
        setIsRecovering(false);
        setIsRepairing(false);
        setRepairSummary(null);
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
        syncError,
        recoveryPlan,
        recoveryError,
        isLoadingRecovery,
        isRecovering,
        isRepairing,
        repairSummary,
        syncProgress,
        nextSyncIn: null,
        handleSyncAll,
        handleReviewRecovery,
        handleContinueRecovery,
        handleRepair,
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
