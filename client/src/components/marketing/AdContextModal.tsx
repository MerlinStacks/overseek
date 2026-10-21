import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { isRecord } from '../../utils/responseValidation';

interface AdContextModalProps { isOpen: boolean; onClose: () => void; onSaved?: () => void }
const endpoint = '/api/dashboard/ad-suggestions/context';
function decodeContext(value: unknown): string {
    if (!isRecord(value) || (value.context != null && typeof value.context !== 'string')) throw new Error('Invalid context');
    return typeof value.context === 'string' ? value.context : '';
}

export function AdContextModal({ isOpen, ...props }: AdContextModalProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!isOpen) return null;
    return <Modal isOpen onClose={props.onClose} title="Add Business Context" maxWidth="max-w-lg">
        {token && currentAccount ? <ContextEditor key={JSON.stringify([token, currentAccount.id])} {...props} accountId={currentAccount.id} token={token} /> : <p role="status">Select an account to edit business context.</p>}
    </Modal>;
}

function ContextEditor({ accountId, token, onClose, onSaved }: Omit<AdContextModalProps, 'isOpen'> & { accountId: string; token: string }) {
    const { data, loading, error, retry } = useScopedRequest(endpoint, accountId, token, decodeContext);
    const [draft, setDraft] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const request = useRef<AbortController | null>(null); const pending = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); if (saveTimer.current) clearTimeout(saveTimer.current); }; }, []);
    const context = draft ?? data ?? '';
    const save = async () => {
        if (pending.current || loading || error || data === null) return;
        pending.current = true; setSaving(true); setSaveError(false);
        const controller = new AbortController(); request.current = controller;
        const timeout = setTimeout(() => controller.abort(), 30000);
        saveTimer.current = timeout;
        try {
            const response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify({ context }) });
            if (!response.ok || controller.signal.aborted) throw new Error('Save failed');
            if (active.current) {
                try { void Promise.resolve(onSaved?.()).catch(() => {}); } catch { /* The context was already saved. */ }
                onClose();
            }
        } catch { if (active.current) setSaveError(true); }
        finally { clearTimeout(timeout); saveTimer.current = null; pending.current = false; if (active.current) setSaving(false); }
    };
    if (loading) return <p role="status">Loading business context...</p>;
    if (error) return <p role="alert">Could not load business context. <button type="button" onClick={retry}>Retry context</button></p>;
    return <div className="space-y-4 text-slate-900 dark:text-slate-100">
        <label className="block text-sm font-medium">Your Notes &amp; Context<textarea value={context} disabled={saving} maxLength={1000} onChange={event => setDraft(event.target.value)} className="mt-2 w-full h-40 p-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800" /></label>
        <p className="text-xs text-slate-500 dark:text-slate-400 text-right">{context.length}/1000 characters</p>
        <p className="text-sm">Mention upcoming promotions, seasonal priorities, margin preferences, or products to avoid.</p>
        {saveError && <p role="alert">Could not save business context. Your notes are retained; check their status before retrying.</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={saving || context.length > 1000} onClick={() => void save()} className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save Context'}</button></div>
    </div>;
}
