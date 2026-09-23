import { useCallback, useEffect, useRef } from 'react';
import { LaunchApiError } from '../components/settings/deliveryEstimates/launchApi';

/** Callers key their recovery form by account/PO/permission. No request survives that scope. */
export function useInventoryRecoveryRequest(accountId: string, token: string) {
    const scope = useRef<AbortController | null>(null);
    const credentials = useRef(token); credentials.current = token;
    useEffect(() => {
        const controller = new AbortController(); scope.current = controller;
        return () => controller.abort();
    }, [accountId]);
    return useCallback(async <T,>(path: string, body?: object): Promise<T> => {
        const signal = scope.current?.signal;
        if (!signal || signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
        const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', signal, cache: 'no-store',
            headers: { Authorization: `Bearer ${credentials.current}`, 'X-Account-ID': accountId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json();
        if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
        if (!response.ok) throw new LaunchApiError(data?.error || `Recovery request failed (${response.status}).`, response.status);
        return data;
    }, [accountId]);
}
