import { useCallback, useEffect, useRef, useState } from 'react';

export type DeliverySyncProgress = {
    totalInputs: number;
    acknowledgedInputs: number;
    pendingInputs: number;
    blockedInputs: number;
    failedInputs: number;
    pluginUpdateRequiredInputs: number;
    dirtyProducts: number;
    rebuildingProducts: boolean;
    rebuildingInbound: boolean;
    scopes: Array<{
        scope: 'settings' | 'product' | 'inbound';
        total: number; synced: number; acknowledged: number; pending: number;
        blocked: number; failed: number; pluginUpdateRequired: number;
    }>;
};

type RequestDisposition = 'queued' | 'already_running' | 'retrying';

export type DeliverySyncStatus = {
    configurationSync: 'not_requested' | 'pending' | 'synced' | 'plugin_update_required' | 'blocked' | 'failed';
    storefrontActivated: boolean;
    receiptSafety?: 'unverified' | 'guarded';
    inboundCapability?: 'unknown' | 'supported' | 'plugin_update_required';
    pendingCount: number;
    syncedCount: number;
    lastAcknowledgedAt: string | null;
    lastError: string | null;
    progress?: DeliverySyncProgress;
};

/** Recovery remains available even when other scopes are still processing. */
function hasHealthyBackgroundWork(status: DeliverySyncStatus | null) {
    if (!status) return false;
    const progress = status.progress;
    const needsRetry = ['blocked', 'failed', 'plugin_update_required'].includes(status.configurationSync)
        || status.inboundCapability === 'plugin_update_required'
        || !!(progress && (progress.blockedInputs || progress.failedInputs || progress.pluginUpdateRequiredInputs));
    return !needsRetry && (status.configurationSync === 'pending'
        || (progress ? !!(progress.pendingInputs || progress.dirtyProducts || progress.rebuildingProducts || progress.rebuildingInbound) : status.pendingCount > 0));
}

/** Read on mount/save, then explicit refresh/retry only. Aborted responses are never applied. */
export function useDeliveryEstimateSync(accountId: string, token: string, canEdit: boolean, saveRevision = 0) {
    const [state, setState] = useState<{ accountId: string; saveRevision: number; status: DeliverySyncStatus | null; busy: boolean; error: string; queued: boolean; requestDisposition?: RequestDisposition }>({ accountId, saveRevision, status: null, busy: true, error: '', queued: false });
    const request = useRef<AbortController | null>(null);
    const stateRef = useRef(state);
    stateRef.current = state;
    const tokenRef = useRef(token);
    tokenRef.current = token;

    const run = useCallback(async (method: 'GET' | 'POST') => {
        const current = stateRef.current;
        if (method === 'POST' && (!canEdit || request.current || (current.accountId === accountId && current.saveRevision === saveRevision && hasHealthyBackgroundWork(current.status)))) return;
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setState(previous => ({ accountId, saveRevision, status: previous.accountId === accountId && previous.saveRevision === saveRevision ? previous.status : null, busy: true, error: '', queued: false }));
        try {
            const response = await fetch('/api/delivery-estimates/sync', {
                method, signal: controller.signal,
                headers: { Authorization: `Bearer ${tokenRef.current}`, 'X-Account-ID': accountId },
            });
            const data = await response.json();
            if (controller.signal.aborted) return;
            if (!response.ok) throw new Error(data.error || `Unable to ${method === 'POST' ? 'queue sync' : 'load sync status'}.`);
            const requestDisposition = method === 'POST' ? (data.requestDisposition ?? 'queued') : undefined;
            const next = { accountId, saveRevision, status: data.status, busy: false, error: '', queued: requestDisposition === 'queued', requestDisposition };
            stateRef.current = next;
            setState(next);
        } catch (error) {
            if (!controller.signal.aborted) setState(previous => ({ ...previous, busy: false, error: error instanceof Error ? error.message : 'Unable to request sync status.' }));
        } finally {
            if (request.current === controller) request.current = null;
        }
    }, [accountId, canEdit, saveRevision]);

    useEffect(() => {
        void run('GET');
        return () => request.current?.abort();
    }, [run]);

    return {
        // Hide pre-save acknowledgements immediately, before the reload effect runs.
        ...(state.accountId === accountId && state.saveRevision === saveRevision ? state : { status: null, busy: true, error: '', queued: false, requestDisposition: undefined }),
        backgroundPending: state.accountId === accountId && state.saveRevision === saveRevision && hasHealthyBackgroundWork(state.status),
        refresh: () => run('GET'),
        queue: () => run('POST'),
    };
}
