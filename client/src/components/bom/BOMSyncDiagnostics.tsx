import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import type { BOMRepairSummary } from '../../hooks/useBOMSync';

interface Run {
    jobId: string;
    state: string;
    finishedAt: string | null;
    cause: string;
    hasCheckpoint: boolean;
    affectedCount: number;
    products: { productId: string; variationId: number; name: string; sku: string | null; available: boolean; reason: string }[];
}
interface Diagnostics {
    fingerprint: string; canReconcile: boolean; runs: Run[];
    repair?: { canStart: boolean; requiresStoppedConfirmation: boolean; blockedReason?: string };
    repairResult?: BOMRepairSummary & { issues: { productId: string; variationId: number; name: string; sku: string | null; code: string; message: string }[] };
}

/** Passive run details are visible even without permission to release the block. */
export function BOMSyncDiagnostics({ onReconciled, onRepair, syncing = false }: {
    onReconciled: () => void;
    onRepair?: (fingerprint: string, confirmedStoppedAndSettled: boolean) => Promise<void>;
    syncing?: boolean;
}) {
    const { token } = useAuth();
    const { currentAccount, activePermissions } = useAccount();
    const accountId = currentAccount?.id;
    const [details, setDetails] = useState<Diagnostics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const [stopped, setStopped] = useState(false);
    const [reviewed, setReviewed] = useState(false);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [repairStopped, setRepairStopped] = useState(false);
    const [repairing, setRepairing] = useState(false);
    const [issueLimit, setIssueLimit] = useState(100);
    const lifecycle = useRef<AbortController | null>(null);
    const submitting = useRef(false);

    useEffect(() => {
        const controller = new AbortController();
        lifecycle.current = controller;
        setDetails(null); setError(null); setStopped(false); setReviewed(false); setNotes(''); setSaving(false); setCompleted(false);
        setRepairStopped(false); setRepairing(false); setIssueLimit(100);
        submitting.current = false;
        if (accountId && token) {
            void (async () => {
                try {
                    const res = await fetch('/api/inventory/bom/sync-diagnostics', {
                        signal: controller.signal,
                        headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId }
                    });
                    const data = await res.json();
                    if (controller.signal.aborted) return;
                    if (!res.ok || !Array.isArray(data.runs) || typeof data.fingerprint !== 'string') {
                        throw new Error(data.error || 'Failed-run details could not be loaded.');
                    }
                    setDetails(data);
                } catch (err) {
                    if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Failed-run details could not be loaded.');
                }
            })();
        }
        return () => controller.abort();
    }, [accountId, token, revision]);

    const reconcile = async () => {
        const controller = lifecycle.current;
        if (!controller || controller.signal.aborted || !accountId || !details?.canReconcile || syncing
            || !activePermissions?.manage_inventory || !stopped || !reviewed || notes.trim().length < 20 || submitting.current) return;
        submitting.current = true; setSaving(true); setError(null);
        try {
            const res = await fetch('/api/inventory/bom/sync-reconcile', {
                signal: controller.signal, method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fingerprint: details.fingerprint, notes: notes.trim(), confirmedStoppedAndSettled: true, confirmedInventoryReviewed: true })
            });
            const data = await res.json();
            if (controller.signal.aborted) return;
            if (!res.ok || data.success !== true) throw new Error(data.error || 'Review was not acknowledged. Refresh details and sync status before retrying.');
            setDetails(null);
            setCompleted(true);
            onReconciled();
        } catch (err) {
            if (!controller.signal.aborted) {
                setError(err instanceof Error ? err.message : 'Review was not acknowledged. Refresh before retrying.');
                // A lost response may follow a successful review; never repeat stale approval.
                setStopped(false); setReviewed(false);
                onReconciled();
            }
        } finally {
            if (!controller.signal.aborted) { submitting.current = false; setSaving(false); }
        }
    };

    const repair = async () => {
        const controller = lifecycle.current;
        if (!onRepair || !controller || controller.signal.aborted || !details?.repair?.canStart || syncing
            || !activePermissions?.manage_inventory || submitting.current
            || (details.repair.requiresStoppedConfirmation && !repairStopped)) return;
        submitting.current = true; setRepairing(true); setError(null);
        try {
            await onRepair(details.fingerprint, repairStopped);
        } catch (err) {
            if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Repair could not start. Refresh sync status.');
        } finally {
            if (!controller.signal.aborted) { submitting.current = false; setRepairing(false); }
        }
    };

    return (
        <section aria-label="Failed BOM run details and inventory review" className="mt-3 space-y-3 border-t border-red-200 pt-3 dark:border-red-800">
            <h4 className="font-semibold">Repair &amp; resume BOM sync</h4>
            {error && <p role="status">{error}</p>}
            {completed && <p role="status">Inventory review archived. Refresh sync status if the block is still displayed; the review itself does not start a sync.</p>}
            {!details && !error && !completed && <p className="text-sm">Loading retained run details…</p>}
            {onRepair && <>
                <p className="text-sm">Automatically checks every current BOM against fresh WooCommerce and internal component stock, repairs mismatches in dependency order, and verifies updates. It never replays the old job or invents stock counts or mappings. Recorded component stock and configured mappings remain the source of truth; physical counts are not audited.</p>
                {details?.repairResult && <div className="space-y-2 rounded-lg bg-white/60 p-3 text-sm dark:bg-black/10">
                    <p className="font-semibold">Last repair: {details.repairResult.repaired} repaired, {details.repairResult.unchanged} already correct, {details.repairResult.failed} need attention.</p>
                    {details.repairResult.failed > 0 && <p>Unaffected products were processed. Fix the specific exceptions below and run repair again. Normal bulk sync stays paused until the full check succeeds.</p>}
                    <ul className="max-h-72 space-y-3 overflow-y-auto">
                        {details.repairResult.issues.slice(0, issueLimit).map(issue => <li key={`${issue.productId}-${issue.variationId}`}>
                            <a className="font-semibold underline" href={`/inventory/product/${encodeURIComponent(issue.productId)}`} target="_blank" rel="noreferrer">{issue.name}</a>
                            <p>SKU: {issue.sku || 'Not set'} · Variation: {issue.variationId || 'Parent'}</p>
                            <p>{issue.message}</p><p className="text-xs">{issue.code}</p>
                        </li>)}
                    </ul>
                    {details.repairResult.issues.length > issueLimit && <button type="button" className="font-semibold underline" onClick={() => setIssueLimit(value => value + 100)}>Show more exceptions ({details.repairResult.issues.length - issueLimit} remaining)</button>}
                </div>}
                {activePermissions?.manage_inventory ? <div className="space-y-3">
                    {details?.repair?.requiresStoppedConfirmation && <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" checked={repairStopped} disabled={saving || repairing || syncing} onChange={event => setRepairStopped(event.target.checked)} className="mt-1" />
                        <span>The older run cannot prove its pending writes have stopped. I have verified its previous worker is stopped and outstanding WooCommerce requests have finished. No manual catalogue-wide stock review is needed.</span>
                    </label>}
                    <button type="button" onClick={repair} disabled={saving || repairing || syncing || !details?.repair?.canStart || (details.repair.requiresStoppedConfirmation && !repairStopped)} className="rounded-lg bg-[var(--primary-color)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">{repairing ? 'Starting automatic repair…' : 'Repair & resume'}</button>
                    {details?.repair?.blockedReason && <p className="text-sm font-medium">{details.repair.blockedReason}</p>}
                    <p className="text-xs">A verified repair archives the failure and unlocks manual/scheduled syncing. Keep BOM definitions stable while it runs. A failed read, unsafe mapping or unverified write becomes a product-specific exception, not a guessed stock value.</p>
                </div> : <p className="text-sm font-semibold">Ask an administrator with inventory management permission to run automatic repair.</p>}
            </>}
            <details className="text-sm" open={!onRepair}>
            <summary className="cursor-pointer font-semibold">Retained run details</summary>
            <div className="mt-2 space-y-3">
            {details?.runs.map(run => (
                <div key={run.jobId} className="rounded-lg bg-white/60 p-3 text-sm dark:bg-black/10">
                    <p className="break-all font-semibold">Run: {run.jobId} ({run.state})</p>
                    {run.finishedAt && <p>Finished: {new Date(run.finishedAt).toLocaleString()}</p>}
                    <p className="mt-1">{run.cause}</p>
                    {!run.hasCheckpoint ? (
                        <p className="mt-2 font-medium">This older run retained counters only, not product identities. Automatic repair checks every current BOM. If using manual review instead, review all BOM products and their component stock, not just the pending list.</p>
                    ) : (
                        <>
                            <p className="mt-2">{run.affectedCount} targets have uncertain outcomes. Also review their other variations and dependent BOMs. A checkpoint identifies targets, not proof that their WooCommerce writes succeeded.</p>
                            {run.products.length > 0 && <ul className="mt-2 max-h-72 space-y-3 overflow-y-auto">
                                {run.products.map(product => <li key={`${product.productId}-${product.variationId}`}>
                                    {product.available ? <a className="font-semibold underline" href={`/inventory/product/${encodeURIComponent(product.productId)}`} target="_blank" rel="noreferrer">{product.name}</a> : <strong>{product.name}</strong>}
                                    <p>SKU: {product.sku || 'Not set'} · Variation: {product.variationId || 'Parent'} · Product ID: {product.productId}</p>
                                    <p>{product.reason}</p>
                                </li>)}
                            </ul>}
                            {run.affectedCount > run.products.length && <p>Showing the first {run.products.length} targets. Review the full BOM inventory or ask an administrator for the complete retained checkpoint.</p>}
                        </>
                    )}
                </div>
            ))}
            </div>
            </details>
            <details open={!onRepair}>
            <summary className="cursor-pointer text-sm font-semibold">Manual inventory review (fallback)</summary>
            <div className="mt-3 space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>Pause automatic BOM syncing in Overview &amp; schedules for this review. Unlocking also re-enables scheduled admission; keep it paused until you are ready.</li>
                <li>Have a system administrator verify the previous BOM worker is stopped and all outstanding WooCommerce stock requests have settled. An expired lock is not proof. Prevent manual retries and BOM edits during review.</li>
                <li>Use Total BOM Products below to review components and quantities. Compare actual WooCommerce stock with verified component/physical stock, including internal products, variations and dependent BOMs. Correct discrepancies in the system that owns that stock, then refresh product data. This page’s preview is cached, not a live stock check.</li>
                <li>Record what you checked and corrected. Complete the review below to archive the old execution and unlock bulk/scheduled BOM sync. This action does not change stock or start a sync.</li>
            </ol>
            {activePermissions?.manage_inventory ? (
                <div className="space-y-3">
                    <label className="block text-sm font-medium">Inventory review notes (required)
                        <textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={saving} minLength={20} maxLength={4000} rows={3} placeholder="Products/components checked, live stock evidence, corrections, and worker shutdown verification…" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                    </label>
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={stopped} disabled={saving} onChange={event => setStopped(event.target.checked)} className="mt-1" />I verified the old worker and any interrupted repair-submission request are stopped, pending stock requests have settled, and no one is retrying these jobs or editing BOMs during this review.</label>
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={saving} onChange={event => setReviewed(event.target.checked)} className="mt-1" />I reviewed and corrected the affected inventory, including dependent BOMs; for runs without reliable checkpoints, I reviewed the full BOM inventory.</label>
                    <button type="button" onClick={reconcile} disabled={saving || repairing || syncing || !details?.canReconcile || !stopped || !reviewed || notes.trim().length < 20} className="rounded-lg bg-[var(--primary-color)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">{saving ? 'Archiving inventory review…' : 'Complete inventory review & unlock'}</button>
                    {details && !details.canReconcile && <p className="text-sm">No stable blocked run is available to release. Refresh details and sync status; running or queued work cannot be reconciled.</p>}
                </div>
            ) : <p className="text-sm font-semibold">Ask an administrator with inventory management permission to complete this review and unlock sync. Share the run ID and finish time above.</p>}
            </div>
            </details>
            <button type="button" disabled={saving || repairing || syncing} onClick={() => setRevision(value => value + 1)} className="text-sm font-semibold underline disabled:opacity-50">Refresh run details</button>
        </section>
    );
}
