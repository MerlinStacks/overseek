import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useRecoveryAttempt } from '../../hooks/useRecoveryAttempt';
import { isRecord } from '../../utils/responseValidation';
import { Modal } from '../ui/Modal';
import { emitCrossTabEvent } from '../../utils/productCrossTabEvents';
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
        {error && <p role="alert">{error}</p>}
        {read.loading ? <p role="status">Loading duplicate candidates…</p> : read.error ? <p role="alert">Candidates unavailable. <button onClick={read.retry}>Retry candidates</button></p> : read.data && <>
            <p>Keep: {read.data.target.firstName} {read.data.target.lastName} · {read.data.target.email} · #{read.data.target.wooId}</p>
            <p>Spend currency and merged totals are unverified. Local changes may be overwritten by a future provider sync. Order indexing is not verified by this operation.</p>
            {read.data.truncated && <p role="status">Only the first 100 candidates are shown.</p>}
            {read.data.duplicates.length === 0 && <p>No exact-email duplicate candidates found.</p>}
            <fieldset disabled={busy || !!error}><legend>Select source customer to delete locally</legend>{read.data.duplicates.map(row => <label className="block p-2" key={row.id}><input type="radio" name="merge-source" checked={selected?.id === row.id} onChange={() => setSelected(row)} /> {row.firstName} {row.lastName} · {row.email} · #{row.wooId}</label>)}</fieldset>
            {hasPermission('manage_customers') && <button disabled={busy || !!error || !selected} onClick={() => void merge()}>{busy ? 'Merging…' : 'Merge & Delete'}</button>}
        </>}
        <button onClick={onClose}>Close</button>
    </div></Modal>;
}
