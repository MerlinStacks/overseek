import { useRef, useState } from 'react';
import type { Receipt } from './launchApi';

export function ReceiptCascadeStatus({ receipt, request, onQueued, canInventory = true }: {
    receipt: Receipt; request: <T>(path: string, body?: object) => Promise<T>; onQueued: () => void; canInventory?: boolean;
}) {
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const settled = ['applied', 'reconciled'].includes(receipt.state);
    const known = ['waiting_receipt', 'pending', 'failed', 'done'].includes(receipt.cascadeState ?? '');
    const retry = async () => {
        if (!canInventory || !settled || receipt.cascadeState !== 'failed' || inFlight.current) return;
        inFlight.current = true; setBusy(true); setError(''); setMessage('');
        try {
            const ack = await request<{ accepted: boolean; operationId: string; cascadeState: string }>(`receipts/${encodeURIComponent(receipt.operationId)}/cascade/retry`, {});
            if (ack.accepted !== true || ack.operationId !== receipt.operationId || !['pending', 'done'].includes(ack.cascadeState)) throw new Error('Unknown cascade acknowledgement. Refresh the operation before retrying.');
            setMessage(ack.cascadeState === 'done' ? 'Server reports BOM follow-up already complete.' : 'BOM follow-up queued, not yet complete. Native stock was not replayed.');
            onQueued();
        } catch (e) {
            if (e instanceof Error && e.name !== 'AbortError') setError(`${e.message} Refresh or retry BOM follow-up only; this request is idempotent and never retries the stock delta.`);
        } finally { inFlight.current = false; setBusy(false); }
    };
    return <div className="space-y-2 border-l-4 border-amber-400 pl-3">
        <p className="font-semibold">Native stock: {settled ? (receipt.state === 'applied' ? 'already applied' : 'operator-attested / reconciled') : 'not confirmed settled'}.</p>
        {!known ? <p role="alert">Unknown BOM follow-up state. Refresh before recovery; no cascade retry is available.</p> : <>
            <p>BOM follow-up: {receipt.cascadeState} · Attempts: {receipt.cascadeAttempts ?? 'not supplied'}</p>
            {receipt.cascadeState === 'waiting_receipt' && <p>BOM follow-up waits for the native stock operation to settle. Resolve stock errors through receipt reconciliation.</p>}
            {receipt.cascadeState === 'pending' && <p>Derived BOM recalculation is pending. Native stock must not be replayed; verified inbound proof waits for completion.</p>}
            {receipt.cascadeState === 'failed' && <p role="alert">Derived BOM recalculation failed. {settled ? 'The native stock operation remains settled; this is not a stock-delta failure.' : 'Resolve the unsettled native stock operation before retrying derived work.'}</p>}
            {receipt.cascadeError && <p role="alert">BOM follow-up error: {receipt.cascadeError}</p>}
            {receipt.cascadeNextAttemptAt && <p>Next BOM attempt: {receipt.cascadeNextAttemptAt}</p>}
            {receipt.cascadeCompletedAt && <p>BOM follow-up completed: {receipt.cascadeCompletedAt}</p>}
            {canInventory && receipt.cascadeState === 'failed' && <button type="button" disabled={!settled || busy} onClick={() => void retry()}>Retry BOM follow-up only</button>}
        </>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </div>;
}
