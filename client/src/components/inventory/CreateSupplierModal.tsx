import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useRecoveryAttempt } from '../../hooks/useRecoveryAttempt';
import { useModalDraftState } from '../../hooks/useModalDraftState';
import { isRecord } from '../../utils/responseValidation';
interface Props { isOpen: boolean; onClose: () => void; onSuccess: (supplier: { id: string; name: string; currency: string }) => void }
export function CreateSupplierModal(props: Props) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount();
    if (!props.isOpen) return null;
    if (!token || !currentAccount) return <Modal isOpen onClose={props.onClose} title="Create New Supplier"><p>Sign in and select an account.</p></Modal>;
    return <ScopedCreate key={JSON.stringify([user?.id, token, currentAccount.id])} {...props} accountId={currentAccount.id} token={token} />;
}
function ScopedCreate({ accountId, token, onClose, onSuccess }: Props & { accountId: string; token: string }) {
    const initial = useMemo(() => ({ id: crypto.randomUUID(), name: '', contactName: '', email: '', phone: '', currency: '', leadTimeMin: '', leadTimeMax: '', paymentTerms: '' }), []);
    const { draft, setDraft } = useModalDraftState(initial, true, accountId);
    const { hasPermission } = usePermissions(); const attempt = useRecoveryAttempt();
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
    const close = () => { if (busy || Object.entries(draft).some(([key, value]) => key !== 'id' && value) && !window.confirm('Discard this supplier draft? If a write was attempted, reconcile the creation identity before starting another.')) return; onClose(); };
    async function submit(event: React.FormEvent) {
        event.preventDefault(); if (blocked || !hasPermission('manage_inventory')) return;
        const lead = (value: string) => value === '' || /^\d+$/.test(value) && Number(value) <= 3650;
        if (!draft.name.trim() || !/^[A-Z]{3}$/.test(draft.currency) || !lead(draft.leadTimeMin) || !lead(draft.leadTimeMax) || draft.leadTimeMin !== '' && draft.leadTimeMax !== '' && Number(draft.leadTimeMin) > Number(draft.leadTimeMax)) { setError('Choose a currency and valid ordered whole-day lead times (0–3650).'); return; }
        const active = attempt.begin(); if (!active) return; setBusy(true); setError(''); const timer = setTimeout(() => active.abort(), 30000);
        try {
            const response = await fetch('/api/inventory/suppliers', { method: 'POST', signal: active.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
            const value = await response.json();
            if (!response.ok || !isRecord(value) || value.id !== draft.id || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 || value.currency !== draft.currency) throw new Error('Unacknowledged');
            if (!attempt.current(active)) return;
            onSuccess({ id: draft.id, name: value.name, currency: draft.currency }); onClose();
        } catch { if (attempt.current(active, true)) { setError('Creation unacknowledged or rejected. It may have committed. Check suppliers using this creation identity before starting another request.'); setBlocked(true); } }
        finally { clearTimeout(timer); attempt.finish(); if (attempt.current(active, true)) setBusy(false); }
    }
    const fields = [{ key: 'name', label: 'Supplier Name', max: 200 }, { key: 'contactName', label: 'Contact Name', max: 200 }, { key: 'email', label: 'Email', max: 320 }, { key: 'phone', label: 'Phone', max: 50 }, { key: 'leadTimeMin', label: 'Minimum lead days', max: 4 }, { key: 'leadTimeMax', label: 'Maximum lead days', max: 4 }, { key: 'paymentTerms', label: 'Payment Terms', max: 500 }] as const;
    return <Modal isOpen onClose={close} title="Create New Supplier" maxWidth="max-w-xl"><form onSubmit={event => void submit(event)} className="space-y-4 text-slate-900 dark:text-slate-100">
        {error && <p role="alert">{error}</p>}{blocked && <p>Creation identity: <code className="break-all">{draft.id}</code>. Reload the supplier list to reconcile; do not blindly create again.</p>}
        {!hasPermission('manage_inventory') && <p>Inventory management permission required.</p>}
        <fieldset disabled={busy || blocked || !hasPermission('manage_inventory')} className="grid gap-3 sm:grid-cols-2"><legend className="sr-only">Supplier details</legend>{fields.map(field => <label key={field.key}>{field.label}<input className="block w-full rounded border bg-white dark:bg-slate-950 p-2" required={field.key === 'name'} type={field.key === 'email' ? 'email' : 'text'} inputMode={field.key.startsWith('lead') ? 'numeric' : undefined} maxLength={field.max} value={draft[field.key]} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} /></label>)}
        <label>Currency<select className="block rounded border bg-white dark:bg-slate-950 p-2" required value={draft.currency} onChange={event => setDraft(current => ({ ...current, currency: event.target.value }))}><option value="" disabled>Select currency</option>{['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'NZD', 'CNY', 'JPY'].map(value => <option key={value}>{value}</option>)}</select></label><button type="submit">{busy ? 'Creating…' : 'Create Supplier'}</button></fieldset>
        <button type="button" disabled={busy} onClick={close}>Close</button>
    </form></Modal>;
}
