import { useCallback, useEffect, useRef, useState } from 'react';
import { useInventoryRecoveryRequest } from '../../../hooks/useInventoryRecoveryRequest';
import { LAUNCH_POLL_LIMIT, LAUNCH_POLL_MS } from '../../../hooks/useDeliveryLaunch';
import { LegacyReceiptRecovery } from './LegacyReceiptRecovery';
import { purchaseOrderHref, type LegacyAttestation, type LegacyJob, type LegacyPage, type ReceiptCycle, type ReceiptCyclePage } from './launchApi';

interface Props { accountId: string; token: string; canInventory: boolean; visible: boolean; onChanged: () => void }
interface PurchaseOrderPreview {
    id: string; accountId: string; orderNumber: string | null; status: string;
    items: { id: string; name: string; quantity: number; productId: string | null; variationWooId: number | null; product?: { wooId: number } | null }[];
}

export function PurchaseOrderReceiptRecovery(props: Props) {
    return <RecoveryLookup key={`${props.accountId}:${props.canInventory}`} {...props} />;
}
function RecoveryLookup(props: Props) {
    const initial = new URLSearchParams(window.location.search).get('purchaseOrderId') ?? '';
    const [input, setInput] = useState(initial);
    const [selected, setSelected] = useState(initial);
    return <section id="purchase-order-recovery" aria-label="Purchase order receipt provenance and recovery" className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h4 className="font-semibold">Purchase order receipt provenance and historical reversal</h4>
        <p>Open a saved PO to inspect immutable receipt cycles, including skipped-only receipts. If an old RECEIVED PO has no active guarded cycle and ordinary unreceive is refused, start its observation-backed historical reversal review here.</p>
        {!props.canInventory ? <p>Read only. Viewing receipt provenance and performing recovery requires manage_inventory.</p> : <>
            <label className="block">Purchase order ID<input className="block w-full rounded border bg-white dark:bg-slate-900 p-2" value={input} onChange={e => setInput(e.target.value)} /></label>
            <button type="button" disabled={!input.trim()} onClick={() => setSelected(input.trim())}>Preview saved purchase order</button>
            {selected && <PurchaseOrderReview key={selected} {...props} purchaseOrderId={selected} />}
        </>}
    </section>;
}

function PurchaseOrderReview({ accountId, token, purchaseOrderId, visible, onChanged }: Props & { purchaseOrderId: string }) {
    const request = useInventoryRecoveryRequest(accountId, token);
    const [po, setPO] = useState<PurchaseOrderPreview | null>(null);
    const [cycles, setCycles] = useState<ReceiptCycle[]>([]);
    const [cycleCursor, setCycleCursor] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const flight = useRef(false);
    const [error, setError] = useState('');
    const [paused, setPaused] = useState(false);
    const [restarted, setRestarted] = useState(false);
    const [reviewed, setReviewed] = useState(false);
    const [reviewId, setReviewId] = useState('');
    const [review, setReview] = useState<LegacyJob | null>(null);
    const [searchCursor, setSearchCursor] = useState<string | null>(null);
    const reviewPage = useRef('');
    const [message, setMessage] = useState('');
    const [polls, setPolls] = useState(0);
    const [pageVisible, setPageVisible] = useState(document.visibilityState !== 'hidden');
    const retries = useRef(new Map<string, LegacyAttestation>());
    const notify = useRef(onChanged); notify.current = onChanged;
    useEffect(() => {
        const change = () => setPageVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', change);
        return () => document.removeEventListener('visibilitychange', change);
    }, []);
    const load = useCallback(async (cursor = '') => {
        if (flight.current) return;
        flight.current = true; setBusy(true); setError('');
        if (!cursor) { setLoaded(false); setPaused(false); setRestarted(false); setReviewed(false); }
        try {
            const [order, page] = await Promise.all([
                request<PurchaseOrderPreview>(`inventory/purchase-orders/${encodeURIComponent(purchaseOrderId)}`),
                request<ReceiptCyclePage>(`delivery-estimates/receipts/cycles?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
            ]);
            if (order.id !== purchaseOrderId || order.accountId !== accountId || !Array.isArray(order.items)
                || !Array.isArray(page.cycles) || page.cycles.some(c => c.accountId !== accountId || c.purchaseOrderId !== purchaseOrderId || typeof c.active !== 'boolean' || !Array.isArray(c.skippedLines))) throw new Error('Unexpected PO or cycle scope. Refresh the saved purchase order.');
            setPO(order); setCycles(previous => cursor ? [...previous, ...page.cycles] : page.cycles); setCycleCursor(page.nextCursor); setLoaded(true);
        } catch (e) { if (e instanceof Error && e.name !== 'AbortError') { setError(e.message); setLoaded(false); } }
        finally { flight.current = false; setBusy(false); }
    }, [accountId, purchaseOrderId, request]);
    useEffect(() => { void load(); }, [load]);

    // The server returns a job ID, not a job document or single-job GET endpoint.
    // Search actual cursor pages, at most ten per explicit search, then offer continuation.
    const findReview = useCallback(async (jobId: string, start = '') => {
        let cursor = start;
        for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
            const page = await request<LegacyPage>(`delivery-estimates/receipts/legacy${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
            if (!Array.isArray(page.jobs) || page.jobs.some(job => job.accountId !== accountId)) throw new Error('Unexpected legacy review scope. Refresh review state.');
            const found = page.jobs.find(job => job.id === jobId);
            if (found) {
                if (found.purchaseOrderId !== purchaseOrderId || found.sourceType !== 'purchase_order_reversal') throw new Error('Unexpected reversal job provenance. Contact your operator.');
                reviewPage.current = cursor; setReview(found); setSearchCursor(null); return;
            }
            if (!page.nextCursor) { setReview(null); setSearchCursor(null); throw new Error('Review job is not in the current list. Refresh review state to try again.'); }
            if (page.nextCursor === cursor) throw new Error('Legacy cursor did not advance. Refresh review state.');
            cursor = page.nextCursor;
        }
        setSearchCursor(cursor);
    }, [accountId, purchaseOrderId, request]);
    const refreshReview = useCallback(async (manual = true, continuation = false) => {
        if (!reviewId || flight.current) return;
        flight.current = true; setBusy(true); setError(''); if (manual) setPolls(0);
        try { await findReview(reviewId, continuation ? searchCursor ?? '' : reviewPage.current); }
        catch (e) { if (e instanceof Error && e.name !== 'AbortError') setError(e.message); }
        finally { flight.current = false; setBusy(false); }
    }, [findReview, reviewId, searchCursor]);
    useEffect(() => {
        if (!visible || !pageVisible || busy || error || review?.state !== 'reconciling' || review.attempts >= 8 || polls >= LAUNCH_POLL_LIMIT) return;
        const timer = window.setTimeout(() => { setPolls(value => value + 1); void refreshReview(false); }, LAUNCH_POLL_MS);
        return () => window.clearTimeout(timer);
    }, [visible, pageVisible, busy, error, review, polls, refreshReview]);
    const eligible = loaded && po?.status === 'RECEIVED' && cycleCursor === null && !cycles.some(cycle => cycle.active);
    const begin = async () => {
        if (!eligible || !paused || !restarted || !reviewed || flight.current) return;
        flight.current = true; setBusy(true); setError(''); setMessage('');
        try {
            const ack = await request<{ accepted: boolean; jobId: string; state: string }>(`delivery-estimates/receipts/legacy-reversals/${encodeURIComponent(purchaseOrderId)}`, { receivingPaused: true, workersRestarted: true });
            if (ack.accepted !== true || typeof ack.jobId !== 'string' || !['pending', 'reconciling', 'reconciliation_failed', 'drained'].includes(ack.state)) throw new Error('Unknown review acknowledgement. Retry the same PO review to recover its existing job.');
            setReviewId(ack.jobId); setMessage(`Review job ${ack.jobId} accepted. This does not confirm stock correction or PO reversal.`);
            notify.current(); await findReview(ack.jobId);
        } catch (e) { if (e instanceof Error && e.name !== 'AbortError') setError(`${e.message} The review request is idempotent for this PO; retry to recover its existing job. Receiving may already be frozen.`); }
        finally { flight.current = false; setBusy(false); }
    };
    return <div className="space-y-3">
        <button type="button" disabled={busy} onClick={() => void load()}>Refresh saved PO and cycles</button>
        {busy && <p role="status">Loading purchase order recovery…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
        {po && <>
            <a className="text-indigo-600 dark:text-indigo-300 underline" href={purchaseOrderHref(po.id)}>Open purchase order {po.orderNumber || po.id}</a>
            <p>Saved status: {po.status}. Saved PO quantities below are advisory historical context, not proof of original applied targets or current physical stock. Unsaved PO drafts are not used.</p>
            <ul>{po.items.map(item => <li key={item.id}>{item.name} · PO quantity: {item.quantity} · Woo product: {item.product?.wooId ?? 'unlinked'} · Variation: {item.variationWooId ?? 'none'}</li>)}</ul>
            <h5 className="font-semibold">Guarded receipt cycles and immutable skipped-line provenance</h5>
            {loaded && cycles.length === 0 && <p>No guarded receipt cycles found on this page.</p>}
            {cycles.map(cycle => <article className="rounded border p-3" key={cycle.id}>
                <p>Cycle {cycle.id} · {cycle.active ? 'Active receipt' : 'Inactive / reversed cycle'} · {cycle.createdAt}</p>
                <p>Reversal uses this cycle’s original applied/reconciled targets, never today’s edited PO items. A skipped-only cycle is real provenance even with no stock operations.</p>
                {cycle.skippedLines.length === 0 ? <p>No skipped lines recorded.</p> : <ul>{cycle.skippedLines.map((line, index) => <li key={`${line.lineId}:${index}`}>Line {line.lineId ?? 'not recorded'} · Product {line.productId ?? 'unlinked'} · Variation {line.variationWooId ?? 'none'} · Quantity {line.quantity} · Skipped: {line.reason}</li>)}</ul>}
            </article>)}
            {cycleCursor && <button type="button" disabled={busy} onClick={() => void load(cycleCursor)}>Load more receipt cycles before review</button>}
            {cycles.some(cycle => cycle.active) && <p>Active guarded provenance exists. Use the PO’s normal ledger reversal; historical review cannot bypass it. A failed BOM follow-up does not justify replaying settled stock.</p>}
            {eligible && <fieldset disabled={busy} className="space-y-2">
                <legend className="font-semibold">Preview historical legacy reversal</legend>
                <p>This creates or reopens an audited review, freezes receiving and queues local disable. It sends no stock delta. Next, establish corrected counts excluding the original receipt effect, preserving other completed movements, excluding later queued native operations, and reviewing dependent BOM stock. Obtain a fresh native observation and confirm its scope before reconciliation. Only the exact worker ACK changes this PO to ORDERED.</p>
                <label className="block"><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /> I have paused receiving for this historical PO reversal.</label>
                <label className="block"><input type="checkbox" checked={restarted} onChange={e => setRestarted(e.target.checked)} /> I have drained legacy work and restarted all pre-upgrade API/worker processes.</label>
                <label className="block"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> I reviewed this saved PO and understand its quantities are not proof of historical stock effects.</label>
                <button type="button" disabled={busy || !paused || !restarted || !reviewed} onClick={() => void begin()}>Start / reopen historical reversal review</button>
            </fieldset>}
        </>}
        {reviewId && <button type="button" disabled={busy} onClick={() => void refreshReview()}>Refresh historical reversal review</button>}
        {searchCursor && <button type="button" disabled={busy} onClick={() => void refreshReview(true, true)}>Continue finding review job</button>}
        {review && <LegacyReceiptRecovery key={review.id} job={review} request={(path, body) => request(`delivery-estimates/${path}`, body)} retryRequests={retries.current}
            onChanged={() => { void refreshReview(); notify.current(); }} />}
        {review?.state === 'drained' && <p role="status">Historical reversal review is drained. The server has acknowledged the PO reversal to ORDERED. Refresh the saved PO to verify its current status; resume cutover in launch controls to release the receiving freeze.</p>}
        {polls >= LAUNCH_POLL_LIMIT && <p>Automatic review checks paused. Refresh historical reversal review to check again.</p>}
    </div>;
}
