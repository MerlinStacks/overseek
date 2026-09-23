import { useRef, useState } from 'react';
import { LaunchApiError, operationSource, purchaseOrderHref, priorAttestation, recoverableReceipt, staleObservation, type Attestation, type Observation, type Receipt } from './launchApi';
import { ReceiptCascadeStatus } from './ReceiptCascadeStatus';

type Props = {
    receipt: Receipt;
    request: <T>(path: string, body?: object) => Promise<T>;
    onQueued: () => void;
    retryRequests: Map<string, Attestation>;
};

/** No inventory writes or delta retries: only an observation and an immutable operator attestation. */
export function ReceiptRecovery({ receipt, request, onQueued, retryRequests }: Props) {
    const [observation, setObservation] = useState<Observation | null>(null);
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('');
    const [attested, setAttested] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [ambiguous, setRetryState] = useState<Attestation | null>(() => retryRequests.get(receipt.operationId) ?? null);
    const [discardedAction, setDiscardedAction] = useState('');
    const previous = receipt.state === 'reconciliation_failed' && !staleObservation(receipt.lastError) ? priorAttestation(receipt.reconciliation) : null;
    const retry = ambiguous ?? (previous?.actionId !== discardedAction ? previous : null);
    const setRetry = (value: Attestation | null) => {
        if (value) retryRequests.set(receipt.operationId, value);
        else retryRequests.delete(receipt.operationId);
        setRetryState(value);
    };
    const inFlight = useRef(false);
    const recoverable = recoverableReceipt(receipt.state);
    const known = ['pending', 'prepared', 'applied', 'uncertain', 'parked', 'reconciling', 'reconciliation_failed', 'reconciled'].includes(receipt.state);
    const path = `receipts/${encodeURIComponent(receipt.operationId)}`;
    const observe = async () => {
        if (!recoverable || inFlight.current || retry) return;
        inFlight.current = true; setBusy(true); setError(''); setMessage(''); setObservation(null); setQuantity(''); setAttested(false);
        try {
            const data = await request<Observation>(`${path}/observation`, {});
            if (data.schemaVersion !== 1 || data.operationId !== receipt.operationId || !Number.isSafeInteger(data.stockQuantity)
                || !data.observationToken || !(Date.parse(data.expiresAt) > Date.now())) throw new Error('Invalid or expired observation. Obtain a fresh observation.');
            setObservation(data);
        } catch (e) { if (e instanceof Error && e.name !== 'AbortError') setError(e.message); }
        finally { inFlight.current = false; setBusy(false); }
    };
    const valid = observation && quantity.trim() !== '' && Number.isSafeInteger(Number(quantity)) && Number(quantity) === observation.stockQuantity
        && reason.trim().length >= 5 && reason.trim().length <= 1000 && attested;
    const reconcile = async () => {
        if (inFlight.current || !known || (!retry && (!recoverable || !valid))) return;
        if (!retry && observation && Date.parse(observation.expiresAt) <= Date.now()) {
            setObservation(null); setError('Observation expired. Verify the corrected stock count and obtain a fresh observation.'); return;
        }
        const body: Attestation = retry ?? { actionId: crypto.randomUUID(), observationToken: observation!.observationToken,
            observedStockQuantity: Number(quantity), reason: reason.trim(), correctedCountIncludesOperation: true };
        // Keep the exact request across a lost ACK. Never generate another UUID for an ambiguous retry.
        setRetry(body); inFlight.current = true; setBusy(true); setError(''); setMessage('');
        try {
            const ack = await request<{ accepted: boolean; operationId: string; actionId: string }>(`${path}/reconcile`, body);
            if (ack.accepted !== true || ack.operationId !== receipt.operationId || ack.actionId !== body.actionId) throw new Error('Unrecognized acknowledgement. Retry the identical attestation.');
            setRetry(null); setObservation(null); setAttested(false);
            setMessage('Reconciliation queued, not yet applied. Refresh to check the worker result.'); onQueued();
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return;
            if (e instanceof LaunchApiError && e.status >= 400 && e.status < 500) {
                setDiscardedAction(body.actionId);
                setRetry(null); setObservation(null); setAttested(false);
                setError(`${e.message} Refresh receipt state, verify the corrected count and obtain a fresh observation before trying again.`);
            } else setError(`${e instanceof Error ? e.message : 'Acknowledgement unavailable.'} Retry the identical attestation first to recover a lost acknowledgement safely.`);
        } finally { inFlight.current = false; setBusy(false); }
    };
    return <article className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
        <h4 className="font-semibold break-all">Receipt {receipt.operationId}</h4>
        <p>Source: {operationSource(receipt.sourceType, receipt.delta)} · Source reference: {receipt.sourceId ?? 'not supplied'}</p>
        {receipt.sourceType === 'purchase_order' && !receipt.purchaseOrderId.startsWith('bom-order:')
            ? <a className="text-indigo-600 dark:text-indigo-300 underline" href={purchaseOrderHref(receipt.purchaseOrderId)}>Open purchase order {receipt.purchaseOrderId}</a>
            : <p>Audit group: {receipt.purchaseOrderId} (not a purchase-order reversal target)</p>}
        <p>Cycle: {receipt.cycleId ?? 'not supplied'} · Product: {receipt.productId} · Woo product: {receipt.productWooId ?? 'not supplied'} · Variation: {receipt.variationWooId ?? 'none'} · Physical stock owner: {receipt.stockOwnerWooId}</p>
        <p>State: {receipt.state} · Sequence: {receipt.sequence} · Original quantity change: {receipt.delta} · Attempts: {receipt.attempts}</p>
        {receipt.lastError && <p role="alert">{receipt.lastError}</p>}
        <ReceiptCascadeStatus receipt={receipt} request={request} onQueued={onQueued} />
        {receipt.state === 'reconciliation_failed' && <p>Reconciliation failed. For a rejected or stale observation, verify the corrected count and obtain a fresh observation with a new action.</p>}
        {!known && <p role="alert">Unknown receipt state. Recovery is unavailable; refresh or contact your operator.</p>}
        {recoverable && <>
            <p>First establish the correct stock count in WooCommerce, including this operation’s effect and excluding later queued operations. Then obtain a fresh observation. This panel never changes stock quantities or retries the original delta.</p>
            <button type="button" disabled={busy || !!retry} onClick={() => void observe()}>Obtain fresh stock observation</button>
        </>}
        {observation && recoverable && !retry && <fieldset disabled={busy} className="space-y-2">
            <p>Observed Woo stock: {observation.stockQuantity}. Expires: <time dateTime={observation.expiresAt}>{observation.expiresAt}</time>. An observation does not prove receipt success.</p>
            <label className="block">Confirm observed corrected quantity<input className="block w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2" type="number" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
            {quantity !== '' && Number(quantity) !== observation.stockQuantity && <p role="alert">Quantity must exactly match the observation. Correct stock in WooCommerce and obtain a new observation if needed.</p>}
            <label className="block">Reconciliation reason (5–1000 characters)<textarea className="block w-full rounded border bg-white dark:bg-slate-900 p-2" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
            <label className="block"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} /> I verified that the corrected stock count includes this operation and excludes later queued operations.</label>
            <button type="button" disabled={!valid || busy} onClick={() => void reconcile()}>Queue reconciliation attestation</button>
        </fieldset>}
        {retry && known && <button type="button" disabled={busy} onClick={() => void reconcile()}>Retry identical attestation</button>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
    </article>;
}
