import { useCallback, useEffect, useRef, useState } from 'react';

export type InputScope = 'settings' | 'product' | 'inbound';
export type InputFilter = 'attention' | 'blocked' | 'failed' | 'plugin_update_required';
export type DeliverySyncInput = {
    id: string; scope: InputScope; entityId: number; status: string;
    desiredRevision: string; ackRevision: string; attempts: number; proofRebuilds: number;
    lastAcknowledgedAt: string | null; updatedAt: string;
    diagnostic: null | {
        source: 'local' | 'remote'; phase: 'capabilities' | 'inputs';
        disposition: 'record_rejection' | 'account_suppression'; attemptedRevision: string | null;
        occurredAt: string; httpStatus: number | null; code: string | null; reason: string | null; message: string;
    };
    payloadSummary: {
        envelopeBytes: number; isTombstone: boolean; variationCount: number | null; targetCount: number | null;
        generatedAt: string | null; expiresAt: string | null; expiredAtObservation: boolean;
    };
};
type InputPage = { schemaVersion: 1; observedAt: string; items: DeliverySyncInput[]; nextCursor: string | null };
export const isAttentionInput = (status: string) => ['blocked', 'failed', 'plugin_update_required'].includes(status);

function requestError(status: number) {
    if (status === 404) return 'Diagnostics unavailable: this backend does not support input diagnostics.';
    if (status === 403) return 'Permission denied. You do not have permission for this diagnostics request.';
    return `Unable to complete diagnostics request (HTTP ${status}).`;
}

/** Mounted only while open, keyed by account and filters by the view. No polling or automatic writes. */
export function useDeliverySyncInputs({ accountId, token, status, scope, canRetry, onRetry }: {
    accountId: string; token: string; status: InputFilter; scope: InputScope | '';
    canRetry: boolean; onRetry: () => unknown;
}) {
    const [page, setPage] = useState<InputPage | null>(null);
    const [cursor, setCursor] = useState<string | null>(null);
    const [history, setHistory] = useState<Array<string | null>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [unsupported, setUnsupported] = useState(false);
    const [pending, setPending] = useState<string[]>([]);
    const [results, setResults] = useState<Record<string, string>>({});
    const read = useRef<AbortController | null>(null);
    const writes = useRef(new Map<string, AbortController>());
    const alive = useRef(true);
    const latest = useRef({ token, canRetry, onRetry, page, loading, unsupported });
    latest.current = { token, canRetry, onRetry, page, loading, unsupported };
    const headers = () => ({ Authorization: `Bearer ${latest.current.token}`, 'X-Account-ID': accountId });

    const load = useCallback(async (next: string | null) => {
        read.current?.abort();
        const controller = new AbortController();
        read.current = controller;
        setLoading(true); setError(''); setPage(null);
        try {
            const query = new URLSearchParams({ status, limit: '25' });
            if (scope) query.set('scope', scope);
            if (next !== null) query.set('cursor', next);
            const response = await fetch(`/api/delivery-estimates/sync/inputs?${query}`, {
                method: 'GET', headers: { Authorization: `Bearer ${latest.current.token}`, 'X-Account-ID': accountId }, signal: controller.signal,
            });
            if (controller.signal.aborted || !alive.current) return;
            if (!response.ok) {
                setUnsupported(response.status === 404);
                setError(requestError(response.status));
                return;
            }
            const data: InputPage = await response.json();
            if (controller.signal.aborted || !alive.current) return;
            if (!data || data.schemaVersion !== 1 || !Array.isArray(data.items)) {
                setError('Diagnostics unavailable: unsupported response format.');
                return;
            }
            setPage(data); setUnsupported(false);
        } catch {
            if (!controller.signal.aborted && alive.current) setError('Unable to load diagnostics.');
        } finally {
            if (!controller.signal.aborted && alive.current) setLoading(false);
        }
    }, [accountId, status, scope]);

    useEffect(() => {
        alive.current = true;
        void load(null);
        const requests = writes.current;
        return () => { alive.current = false; read.current?.abort(); requests.forEach(controller => controller.abort()); requests.clear(); };
    }, [load]);

    const retry = async (id: string) => {
        const current = latest.current;
        const input = current.page?.items.find(item => item.id === id);
        if (!alive.current || !current.canRetry || current.loading || current.unsupported || !input || !isAttentionInput(input.status) || writes.current.has(id)) return;
        const controller = new AbortController();
        writes.current.set(id, controller);
        setPending([...writes.current.keys()]);
        setResults(previous => ({ ...previous, [id]: '' }));
        try {
            const response = await fetch(`/api/delivery-estimates/sync/inputs/${encodeURIComponent(id)}/retry`, {
                method: 'POST', headers: headers(), signal: controller.signal,
            });
            if (controller.signal.aborted || !alive.current) return;
            if (!response.ok) {
                const message = response.status === 404
                    ? 'This input was not found in this account. Refresh diagnostics to check available inputs.'
                    : requestError(response.status);
                setResults(previous => ({ ...previous, [id]: message }));
                return;
            }
            const data = await response.json();
            if (controller.signal.aborted || !alive.current) return;
            if (!data || data.accepted !== true || data.inputId !== id || !['queued', 'rebuilding', 'already_running'].includes(data.disposition)) {
                setResults(previous => ({ ...previous, [id]: 'Unexpected retry response. Refresh diagnostics to check this input.' }));
                return;
            }
            setResults(previous => ({ ...previous, [id]: data.disposition === 'already_running'
                ? 'This input is already running; it was not restarted. Completion is not confirmed.'
                : `This input was accepted for ${data.disposition === 'rebuilding' ? 'rebuilding' : 'queued processing'}. Completion is not confirmed.` }));
            void latest.current.onRetry();
            void load(cursor);
        } catch {
            if (!controller.signal.aborted && alive.current) setResults(previous => ({ ...previous, [id]: 'Unable to retry this input.' }));
        } finally {
            if (writes.current.get(id) === controller) writes.current.delete(id);
            if (alive.current) setPending([...writes.current.keys()]);
        }
    };

    return {
        page, loading, error, unsupported, pending, results, retry,
        refresh: () => load(cursor),
        hasPrevious: history.length > 0,
        next: () => { if (!loading && page?.nextCursor) { setHistory(previous => [...previous, cursor]); setCursor(page.nextCursor); void load(page.nextCursor); } },
        previous: () => { if (!loading && history.length) { const next = history[history.length - 1]; setHistory(history.slice(0, -1)); setCursor(next); void load(next); } },
    };
}
