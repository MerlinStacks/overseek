import { useCallback, useEffect, useRef, useState } from 'react';
import { knownControl, LaunchApiError, pendingReceipt, type DeliveryReadiness, type ReceiptPage, type LegacyPage } from '../components/settings/deliveryEstimates/launchApi';

export const LAUNCH_POLL_LIMIT = 12;
export const LAUNCH_POLL_MS = 5000;

/** The panel keys this hook by account and permissions. All requests are cancelled on scope exit. */
export function useDeliveryLaunch(accountId: string, token: string, canInventory: boolean, visible: boolean, saveRevision: number, canRead = true) {
    const [readiness, setReadiness] = useState<{ revision: number; value: DeliveryReadiness } | null>(null);
    const [receipts, setReceipts] = useState<ReceiptPage | null>(null);
    const [cursor, setCursor] = useState('');
    const [legacy, setLegacy] = useState<LegacyPage | null>(null);
    const [legacyCursor, setLegacyCursor] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [polls, setPolls] = useState(0);
    const [pageVisible, setPageVisible] = useState(document.visibilityState !== 'hidden');
    const requests = useRef(new Set<AbortController>());
    const alive = useRef(true);
    const readRequest = useRef<AbortController | null>(null);
    const tokenRef = useRef(token); tokenRef.current = token;

    useEffect(() => {
        alive.current = true;
        const controllers = requests.current;
        const onVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', onVisibility);
        return () => { alive.current = false; controllers.forEach(c => c.abort()); document.removeEventListener('visibilitychange', onVisibility); };
    }, []);

    const request = useCallback(async <T,>(path: string, body?: object, signal?: AbortSignal): Promise<T> => {
        if (!alive.current) throw new DOMException('Request cancelled', 'AbortError');
        const controller = new AbortController();
        requests.current.add(controller);
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort);
        if (signal?.aborted) controller.abort();
        try {
            const response = await fetch(`/api/delivery-estimates/${path}`, {
                method: body === undefined ? 'GET' : 'POST', signal: controller.signal, cache: 'no-store',
                headers: { Authorization: `Bearer ${tokenRef.current}`, 'X-Account-ID': accountId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const data = await response.json();
            if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
            if (!response.ok) throw new LaunchApiError(data.error || `Delivery request failed (${response.status}).`, response.status);
            return data;
        } finally { requests.current.delete(controller); signal?.removeEventListener('abort', abort); }
    }, [accountId]);

    const refresh = useCallback(async (manual = true) => {
        if (!alive.current) return;
        if (manual) setPolls(0);
        readRequest.current?.abort();
        const controller = new AbortController(); readRequest.current = controller;
        setLoading(true); setError('');
        const results = await Promise.allSettled([
            canRead ? request<DeliveryReadiness>('readiness', undefined, controller.signal) : Promise.resolve(null),
            canInventory ? request<ReceiptPage>(`receipts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, controller.signal) : Promise.resolve(null),
            canInventory ? request<LegacyPage>(`receipts/legacy${legacyCursor ? `?cursor=${encodeURIComponent(legacyCursor)}` : ''}`, undefined, controller.signal) : Promise.resolve(null),
        ]);
        if (controller.signal.aborted) return;
        const [status, rows, legacyRows] = results;
        const errors: string[] = [];
        if (!canRead) setReadiness(null);
        else if (status.status === 'fulfilled' && status.value && Array.isArray(status.value.blockers) && Array.isArray(status.value.warnings) && knownControl(status.value)) {
            setReadiness({ revision: saveRevision, value: status.value });
        } else {
            setReadiness(null);
            errors.push(status.status === 'rejected' ? status.reason.message : 'Unknown launch response. Refresh readiness or update the client before setup.');
        }
        if (rows.status === 'fulfilled' && (!canInventory || (Array.isArray(rows.value?.receipts) && Array.isArray(rows.value?.legacyJobs)
            && rows.value.receipts.every(row => row.accountId === accountId) && rows.value.legacyJobs.every(row => row.accountId === accountId)))) setReceipts(rows.value);
        else { setReceipts(null); errors.push(rows.status === 'rejected' ? rows.reason.message : 'Unknown receipt response. Refresh receipts.'); }
        if (legacyRows.status === 'fulfilled' && (!canInventory || (Array.isArray(legacyRows.value?.jobs)
            && legacyRows.value.jobs.every(job => job.accountId === accountId)))) setLegacy(legacyRows.value);
        else { setLegacy(null); errors.push(legacyRows.status === 'rejected' ? legacyRows.reason.message : 'Unknown legacy job response. Refresh legacy jobs.'); }
        setError(errors.join(' ')); setLoading(false);
    }, [accountId, canRead, canInventory, cursor, legacyCursor, request, saveRevision]);

    useEffect(() => {
        if (visible && pageVisible) void refresh(false);
        else { readRequest.current?.abort(); setLoading(false); }
        return () => readRequest.current?.abort();
    }, [refresh, visible, pageVisible]);
    const current = readiness?.revision === saveRevision ? readiness.value : null;
    const pending = (!!current && ((current.work.action !== null && current.work.attempts < 8) || current.revalidationRequested === true))
        || !!receipts?.receipts.some(pendingReceipt) || !!legacy?.jobs.some(job => job.state === 'reconciling' && job.attempts < 8);
    useEffect(() => {
        if (!visible || !pageVisible) return;
        if (!pending || loading || error || polls >= LAUNCH_POLL_LIMIT) return;
        const timer = window.setTimeout(() => { setPolls(count => count + 1); void refresh(false); }, LAUNCH_POLL_MS);
        return () => window.clearTimeout(timer);
    }, [visible, pageVisible, pending, loading, error, polls, refresh]);

    return { readiness: current, receipts, cursor, setCursor, legacy, legacyCursor, setLegacyCursor, error, loading, refresh, request,
        pollingStopped: pending && polls >= LAUNCH_POLL_LIMIT };
}
