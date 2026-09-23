import { useRef, useState } from 'react';
import { LaunchApiError, operationSource, purchaseOrderHref, priorLegacyAttestation, staleObservation, type LegacyAttestation, type LegacyJob, type LegacyObservation } from './launchApi';

interface Props {
    job: LegacyJob;
    request: <T>(path: string, body?: object) => Promise<T>;
    onChanged: () => void;
    retryRequests: Map<string, LegacyAttestation>;
}

/** Legacy recovery observes and attests current inventory; historical targets are never replayed. */
export function LegacyReceiptRecovery({ job, request, onChanged, retryRequests }: Props) {
    const [paused, setPaused] = useState(false);
    const [restarted, setRestarted] = useState(false);
    const [observation, setObservation] = useState<LegacyObservation | null>(null);
    const [reason, setReason] = useState('');
    const [attested, setAttested] = useState(false);
    const [reversalConfirmed, setReversalConfirmed] = useState(false);
    const reversal = job.sourceType === 'purchase_order_reversal';
    const [unobservableReviewed, setUnobservableReviewed] = useState(false);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [ambiguous, setRetryState] = useState<LegacyAttestation | null>(() => retryRequests.get(job.id) ?? null);
    const [discardedAction, setDiscardedAction] = useState('');
    const previous = job.state === 'reconciliation_failed' && !staleObservation(job.lastError) ? priorLegacyAttestation(job.reconciliation) : null;
    const retry = ambiguous ?? (previous?.actionId !== discardedAction ? previous : null);
    const setRetry = (value: LegacyAttestation | null) => {
        if (value) retryRequests.set(job.id, value); else retryRequests.delete(job.id);
        setRetryState(value);
    };
    const knownSource = ['purchase_order', 'purchase_order_reversal', 'bom_consumption', 'bom_reversal'].includes(job.sourceType ?? '');
    const known = knownSource && ['pending', 'reconciling', 'reconciliation_failed', 'drained'].includes(job.state);
    const recoverable = known && ['pending', 'reconciliation_failed'].includes(job.state);
    const path = `receipts/legacy/${encodeURIComponent(job.id)}`;
    const observe = async () => {
        if (!recoverable || !paused || !restarted || retry || inFlight.current) return;
        inFlight.current = true; setBusy(true); setError(''); setMessage(''); setObservation(null); setAttested(false); setReversalConfirmed(false); setUnobservableReviewed(false);
        try {
            const data = await request<LegacyObservation>(`${path}/observation`, { receivingPaused: true, workersRestarted: true });
            if (data.schemaVersion !== 1 || data.jobId !== job.id || typeof data.sourceIncomplete !== 'boolean'
                || !Array.isArray(data.owners) || !Array.isArray(data.unobservable)
                || data.owners.some(owner => !Number.isSafeInteger(owner.stockOwnerWooId) || !Number.isSafeInteger(owner.stockQuantity))
                || !data.observationToken || !(Date.parse(data.expiresAt) > Date.now())) throw new Error('Invalid or expired legacy observation. Obtain a fresh observation.');
            setObservation(data);
        } catch (e) { if (e instanceof Error && e.name !== 'AbortError') setError(`${e.message} Receiving may already be frozen. Refresh and review before retrying.`); }
        finally { inFlight.current = false; setBusy(false); onChanged(); }
    };
    const needsManualReview = observation && (reversal || observation.sourceIncomplete || observation.unobservable.length > 0 || observation.owners.length === 0);
    const valid = recoverable && observation && paused && restarted && attested && reason.trim().length >= 5 && reason.trim().length <= 1000
        && (!needsManualReview || unobservableReviewed) && (!reversal || reversalConfirmed);
    const reconcile = async () => {
        if (!known || inFlight.current || (!retry && !valid)) return;
        if (!retry && observation && Date.parse(observation.expiresAt) <= Date.now()) {
            setObservation(null); setError('Legacy observation expired. Verify corrected inventory and obtain a fresh observation.'); return;
        }
        const body: LegacyAttestation = retry ?? { receivingPaused: true, workersRestarted: true, actionId: crypto.randomUUID(),
            observationToken: observation!.observationToken, reason: reason.trim(), correctedInventoryIncludesLegacyWork: true,
            acknowledgeUnobservableTargets: unobservableReviewed, ...(reversal ? { legacyReceiptReversalConfirmed: true as const } : {}) };
        setRetry(body); inFlight.current = true; setBusy(true); setError(''); setMessage('');
        try {
            const ack = await request<{ accepted: boolean; jobId: string; actionId: string; state: string }>(`${path}/reconcile`, body);
            if (ack.accepted !== true || ack.jobId !== job.id || ack.actionId !== body.actionId) throw new Error('Unrecognized legacy acknowledgement. Retry the identical attestation.');
            setRetry(null); setObservation(null); setAttested(false);
            setMessage('Legacy reconciliation queued, not yet confirmed drained. Refresh to check the worker result. Receiving stays frozen until explicit cutover.');
            onChanged();
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return;
            if (e instanceof LaunchApiError && e.status >= 400 && e.status < 500) {
                setDiscardedAction(body.actionId);
                setRetry(null); setObservation(null); setAttested(false);
                setError(`${e.message} Refresh the job, verify corrected inventory and obtain a fresh observation.`);
            } else setError(`${e instanceof Error ? e.message : 'Legacy acknowledgement unavailable.'} Retry the identical legacy attestation first; no stock operation will be replayed.`);
        } finally { inFlight.current = false; setBusy(false); }
    };
    return <article className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
        <h5 className="font-semibold">Legacy job {job.id}</h5>
        <p>Source: {operationSource(job.sourceType)} · Reference: {job.sourceId ?? 'not supplied'}</p>
        {(job.sourceType === 'purchase_order' || reversal) && !job.purchaseOrderId.startsWith('bom-order:') && <a className="text-indigo-600 dark:text-indigo-300 underline" href={purchaseOrderHref(job.purchaseOrderId)}>Open purchase order {job.purchaseOrderId}</a>}
        <p>Purchase order: {job.purchaseOrderId} · State: {job.state} · Attempts: {job.attempts} · Created: {job.createdAt}</p>
        {job.lastError && <p role="alert">{job.lastError}</p>}
        {!known && <p role="alert">Unknown legacy job state or source. Recovery is unavailable; refresh or contact your operator.</p>}
        {!job.originalTargetsAvailable && <p>Original targets were not recorded. Current purchase-order links are advisory only; manually review inventory and dependent BOM work.</p>}
        {!!job.targets?.length && <p>Affected historical targets: {job.targets.map(target => `${target.productWooId}${target.variationWooId ? ` / variation ${target.variationWooId}` : ''}`).join(', ')}. Historical stock intent is not evidence of current inventory.</p>}
        {recoverable && <>
            <p>{reversal ? 'Establish corrected counts excluding the original legacy receipt effect, preserving other completed movements, excluding later queued native operations, and reviewing dependent BOM stock. The exact observation/audit ACK returns the PO to ORDERED; no guessed reversal delta is sent.' : 'Establish correct inventory in WooCommerce including this legacy job’s effects and dependent BOM work before observing.'} Do not replay the legacy job. Receiving will be frozen by this review and stays frozen until you resume cutover.</p>
            <fieldset disabled={busy || !!retry} className="space-y-2">
                <label className="block"><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /> Inventory receiving is paused for this legacy review.</label>
                <label className="block"><input type="checkbox" checked={restarted} onChange={e => setRestarted(e.target.checked)} /> Legacy process-local work is drained and all pre-upgrade API/worker processes are restarted.</label>
                <button type="button" disabled={!paused || !restarted || busy || !!retry} onClick={() => void observe()}>Observe legacy inventory</button>
            </fieldset>
        </>}
        {observation && recoverable && !retry && <fieldset disabled={busy} className="space-y-2">
            <p>Observation expires: <time dateTime={observation.expiresAt}>{observation.expiresAt}</time>. This does not prove the old write ran.</p>
            <ul>{observation.owners.map(owner => <li key={owner.stockOwnerWooId}>Observed stock owner {owner.stockOwnerWooId}: {owner.stockQuantity}</li>)}</ul>
            {observation.sourceIncomplete && <p role="alert">Source incomplete: original affected targets are unavailable.</p>}
            {!!observation.unobservable.length && <div><h6 className="font-semibold">Unobservable inventory</h6><ul>{observation.unobservable.map((item, index) => <li key={index}>
                {'target' in item ? `Product ${item.target.productWooId}${item.target.variationWooId ? ` / variation ${item.target.variationWooId}` : ''}` : `Stock owner ${item.stockOwnerWooId}`}: {item.reason}
            </li>)}</ul></div>}
            <label className="block">Legacy reconciliation reason (5–1000 characters)<textarea className="block w-full rounded border bg-white dark:bg-slate-900 p-2" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
            <label className="block"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} /> {reversal ? 'I verified the displayed corrected counts against the historical receipt reversal scope.' : 'I verified the displayed corrected counts and inventory including this legacy job’s effects and dependent BOM work.'}</label>
            {reversal && <label className="block"><input type="checkbox" checked={reversalConfirmed} onChange={e => setReversalConfirmed(e.target.checked)} /> I confirm inventory excludes the original legacy receipt effect, preserves other completed movements, excludes later queued native operations, and includes review of dependent BOM stock.</label>}
            {needsManualReview && <label className="block"><input type="checkbox" checked={unobservableReviewed} onChange={e => setUnobservableReviewed(e.target.checked)} /> I manually reviewed unobservable inventory, missing original targets and dependent work; this is not automatic proof.</label>}
            <button type="button" disabled={!valid || busy} onClick={() => void reconcile()}>Queue legacy reconciliation attestation</button>
        </fieldset>}
        {retry && known && <button type="button" disabled={busy} onClick={() => void reconcile()}>Retry identical legacy attestation</button>}
        {job.state === 'reconciliation_failed' && <p>For stale/rejected stock observations, verify corrected inventory and obtain a new observation. For a lost acknowledgement, retry the identical prior attestation first.</p>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </article>;
}
