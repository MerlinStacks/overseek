import { useCallback, useEffect, useRef, useState } from 'react';

export type DeliverySyncStatus = {
    configurationSync: 'not_requested' | 'pending' | 'synced' | 'plugin_update_required' | 'blocked' | 'failed';
    storefrontActivated: boolean;
    receiptSafety?: 'unverified' | 'guarded';
    inboundCapability?: 'unknown' | 'supported' | 'plugin_update_required';
    pendingCount: number;
    syncedCount: number;
    lastAcknowledgedAt: string | null;
    lastError: string | null;
};

/** Read on mount/save, then explicit refresh/retry only. Aborted responses are never applied. */
export function useDeliveryEstimateSync(accountId: string, token: string, canEdit: boolean, saveRevision = 0) {
    const [state, setState] = useState<{ accountId: string; saveRevision: number; status: DeliverySyncStatus | null; busy: boolean; error: string; queued: boolean }>({ accountId, saveRevision, status: null, busy: true, error: '', queued: false });
    const request = useRef<AbortController | null>(null);
    const tokenRef = useRef(token);
    tokenRef.current = token;

    const run = useCallback(async (method: 'GET' | 'POST') => {
        if (method === 'POST' && !canEdit) return;
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
            setState({ accountId, saveRevision, status: data.status, busy: false, error: '', queued: method === 'POST' });
        } catch (error) {
            if (!controller.signal.aborted) setState(previous => ({ ...previous, busy: false, error: error instanceof Error ? error.message : 'Unable to request sync status.' }));
        }
    }, [accountId, canEdit, saveRevision]);

    useEffect(() => {
        void run('GET');
        return () => request.current?.abort();
    }, [run]);

    return {
        // Hide pre-save acknowledgements immediately, before the reload effect runs.
        ...(state.accountId === accountId && state.saveRevision === saveRevision ? state : { status: null, busy: true, error: '', queued: false }),
        refresh: () => run('GET'),
        queue: () => run('POST'),
    };
}
