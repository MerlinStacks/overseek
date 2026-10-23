import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useRecoveryAttempt } from '../../hooks/useRecoveryAttempt';
import { isRecord } from '../../utils/responseValidation';
import { Modal } from '../ui/Modal';
import { emitCrossTabEvent } from '../../utils/productCrossTabEvents';
import { ArrowDown, User, AlertTriangle } from 'lucide-react';
import { workspaceStyles as ui } from '../ui/workspaceStyles';
import { DataNote } from '../ui/DataNote';
interface Customer { id: string; wooId: number; firstName: string | null; lastName: string | null; email: string; updatedAt: string }
interface Props { isOpen: boolean; onClose: () => void; customerId: string; onMergeComplete: () => void }
function customer(value: unknown): Customer {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 200 || !Number.isSafeInteger(value.wooId) || Number(value.wooId) <= 0 || typeof value.email !== 'string' || value.email.length > 320 || !['firstName', 'lastName'].every(key => value[key] === null || typeof value[key] === 'string' && String(value[key]).length <= 200) || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid customer');
    return value as unknown as Customer;
}
function decode(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.duplicates) || value.duplicates.length > 100 || typeof value.truncated !== 'boolean') throw new Error('Invalid candidates');
    const target = customer(value.target), duplicates = value.duplicates.map(customer);
    if (duplicates.some(row => row.id === target.id) || new Set(duplicates.map(row => row.id)).size !== duplicates.length) throw new Error('Invalid duplicate identities');
    return { target, duplicates, truncated: value.truncated };
}
export function MergeCustomerModal(props: Props) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!props.isOpen) return null;
    if (!token || !currentAccount || !hasPermission('view_customers')) return <Modal isOpen onClose={props.onClose} title="Merge Duplicate Customers"><p>Selected account and customer view permission required.</p></Modal>;
    return <ScopedMerge key={JSON.stringify([user?.id, token, currentAccount.id, props.customerId])} {...props} token={token} accountId={currentAccount.id} />;
}
function ScopedMerge({ token, accountId, customerId, onClose, onMergeComplete }: Props & { token: string; accountId: string }) {
    const read = useScopedRequest(`/api/customers/${encodeURIComponent(customerId)}/duplicates`, accountId, token, decode);
    const { hasPermission } = usePermissions(); const attempt = useRecoveryAttempt();
    const [selected, setSelected] = useState<Customer | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function merge() {
        const target = read.data?.target, source = selected;
        if (!target || !source || error || !hasPermission('manage_customers') || !window.confirm(`Merge ${source.email} (#${source.wooId}) into #${target.wooId} and delete source? This is a local merge, not a WooCommerce deletion.`)) return;
        const active = attempt.begin(); if (!active) return; setBusy(true);
        const timer = setTimeout(() => active.abort(), 30000);
        try {
            const response = await fetch(`/api/customers/${encodeURIComponent(target.id)}/merge`, { method: 'POST', signal: active.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: source.id, sourceVersion: source.updatedAt, targetVersion: target.updatedAt, occurrence: crypto.randomUUID() }) });
            const result = await response.json();
            if (!response.ok || !isRecord(result) || result.success !== true || result.targetId !== target.id || result.sourceId !== source.id || !Number.isSafeInteger(result.ordersTransferred)) throw new Error('Merge not acknowledged');
            if (!attempt.current(active)) return;
            emitCrossTabEvent({ resource: 'customer', type: 'merged', accountId });
            onMergeComplete(); onClose();
        } catch { if (attempt.current(active, true)) setError('Merge not acknowledged or records changed. It may have committed. Close and reconcile both customer records before attempting another merge; do not blindly retry.'); }
        finally { clearTimeout(timer); attempt.finish(); if (attempt.current(active, true)) setBusy(false); }
    }
    return <Modal isOpen onClose={onClose} title="Merge Duplicate Customers" maxWidth="max-w-2xl"><div className="space-y-4 text-slate-900 dark:text-slate-100">
        {error && <p role="alert" className={ui.alert}>{error}</p>}
        {read.loading ? <p role="status" className={ui.empty}>Loading duplicate candidates…</p> : read.error ? <p role="alert" className={ui.alert}>Candidates unavailable. <button type="button" className={ui.secondary} onClick={read.retry}>Retry candidates</button></p> : read.data && <>
            <section aria-label="Customer to keep" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"><h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"><User size={16} />Keep this customer</h3><p className="break-words font-semibold">{read.data.target.firstName} {read.data.target.lastName}</p><p className="mt-1 break-all text-sm">{read.data.target.email}</p><p className={`mt-1 ${ui.muted}`}>WooCommerce #{read.data.target.wooId}</p></section>
            <DataNote title="How this merge works">Spend currency and merged totals are unverified. Local changes may be overwritten by a future provider sync. Order indexing is not verified by this operation.</DataNote>
            {read.data.truncated && <p role="status">Only the first 100 candidates are shown.</p>}
            {read.data.duplicates.length === 0 && <p className={ui.empty}>No exact-email duplicate candidates found.</p>}
            <fieldset disabled={busy || !!error} className="space-y-2"><legend className="mb-3 flex items-center gap-2 text-sm font-semibold"><ArrowDown size={16} className="text-slate-400" />Select source customer to delete locally</legend>{read.data.duplicates.map(row => <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${selected?.id === row.id ? 'border-[var(--primary-color)] bg-[var(--brand-subtle)] ' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/30'}`} key={row.id}><input className={`mt-1 ${ui.checkbox}`} type="radio" name="merge-source" checked={selected?.id === row.id} onChange={() => setSelected(row)} /><span className="min-w-0"><span className="block break-words text-sm font-medium">{row.firstName} {row.lastName}</span><span className={`mt-1 block break-all ${ui.muted}`}>{row.email} · #{row.wooId}</span></span></label>)}</fieldset>
            {selected && <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle size={16} className="shrink-0" />The selected source record will be deleted locally. Review both customers before confirming.</p>}
            {hasPermission('manage_customers') && <button type="button" className={ui.danger} disabled={busy || !!error || !selected} onClick={() => void merge()}>{busy ? 'Merging…' : 'Merge & Delete'}</button>}
        </>}
        <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-700"><button type="button" className={ui.secondary} onClick={onClose}>Close</button></div>
    </div></Modal>;
}
