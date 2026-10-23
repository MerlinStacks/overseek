import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { api } from '../../services/api';
import { isRecord } from '../../utils/responseValidation';
import { Modal } from '../ui/Modal';
import { CheckCheck, GitMerge, RotateCcw, Tag, UserRound } from 'lucide-react';
import { workspaceStyles as ui } from '../ui/workspaceStyles';

interface Props {
    selectedIds: string[]; onClearSelection: () => void; onActionComplete: () => void;
    users?: { id: string; fullName: string }[];
    labels?: { id: string; name: string; color: string }[];
    conversations?: { id: string; customer: string; subject: string | null; channel?: string }[];
}
export function BulkActionToolbar(props: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    const ids = [...new Set(props.selectedIds)].sort();
    if (!ids.length) return null;
    if (!token || !currentAccount || !ids.every(id => typeof id === 'string' && id.trim())) return <p role="alert">Select an account and valid conversations before applying bulk actions.</p>;
    return <ScopedToolbar key={JSON.stringify([token, currentAccount.id, ids])} {...props} selectedIds={ids} token={token} accountId={currentAccount.id} />;
}
function ScopedToolbar({ selectedIds, onClearSelection, onActionComplete, users = [], labels = [], conversations = [], token, accountId }: Props & { token: string; accountId: string }) {
    const mutation = useScopedMutation(); const [mergeTarget, setMergeTarget] = useState<string | null>(null);
    const [assignee, setAssignee] = useState(''); const [label, setLabel] = useState('');
    const [confirmed, setConfirmed] = useState(false); const [feedback, setFeedback] = useState('');
    const run = async (action: 'close' | 'open' | 'assign' | 'addLabel' | 'merge') => {
        if (mutation.isPending() || confirmed || !mutation.isActive()) return;
        if (action === 'assign' && !users.some(user => user.id === assignee)) return;
        if (action === 'addLabel' && !labels.some(item => item.id === label)) return;
        if (action === 'merge' && (!mergeTarget || !selectedIds.includes(mergeTarget) || selectedIds.length < 2)) return;
        const expected = action === 'merge' ? selectedIds.length - 1 : selectedIds.length;
        const result = await mutation.run(async signal => {
            const data: unknown = await api.request(`/api/chat/conversations/${action === 'merge' ? 'bulk-merge' : 'bulk'}`, {
                method: 'POST', token, accountId, signal,
                body: JSON.stringify(action === 'merge' ? { targetId: mergeTarget, sourceIds: selectedIds.filter(id => id !== mergeTarget) } : { conversationIds: selectedIds, action, ...(action === 'assign' ? { assignToUserId: assignee } : {}), ...(action === 'addLabel' ? { labelId: label } : {}) }),
            });
            const count = isRecord(data) ? data[action === 'merge' ? 'mergedCount' : 'updated'] : undefined;
            if (!isRecord(data) || data.success !== true || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > expected) throw new Error('Invalid bulk confirmation');
            return count;
        }, 'Could not confirm the bulk operation. It may have completed. Your selection is retained; refresh and check before retrying.');
        if (!result.ok) return;
        setConfirmed(true); setMergeTarget(null);
        setFeedback(result.value === expected ? 'Bulk operation confirmed.' : `Confirmed ${result.value} of ${expected} updates. Selection retained; review the refreshed list.`);
        try {
            await onActionComplete();
            if (mutation.isActive() && result.value === expected) onClearSelection();
        } catch {
            if (mutation.isActive()) setFeedback('Operation confirmed, but the list could not be refreshed. Do not repeat the operation; refresh the inbox.');
        }
    };
    const locked = mutation.busy || confirmed;
    return <aside aria-label="Bulk conversation actions" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-h-[70dvh] overflow-y-auto w-[calc(100%-2rem)] max-w-3xl p-4 space-y-3 rounded-xl bg-white text-slate-900 border border-slate-200 shadow-sm dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">{selectedIds.length} selected</p><button className={ui.secondary} type="button" disabled={mutation.busy} onClick={onClearSelection}>Clear selection</button></div>
        {mutation.error && <p className={ui.alert} role="alert">{mutation.error}</p>}{feedback && <p className={ui.notice} role="status">{feedback}</p>}{mutation.busy && <p className={ui.muted} role="status">Applying bulk operation...</p>}
        <fieldset disabled={locked} className="flex min-w-0 flex-wrap items-end gap-3 disabled:opacity-70">
            <button className={ui.primary} type="button" onClick={() => void run('close')}><CheckCheck size={16} aria-hidden="true" />Close</button><button className={ui.secondary} type="button" onClick={() => void run('open')}><RotateCcw size={16} aria-hidden="true" />Reopen</button>
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2"><label className={`${ui.label} min-w-36 flex-1`}>Assignee<select value={assignee} onChange={event => setAssignee(event.target.value)} className={ui.input}><option value="">Choose team member</option>{users.map(user => <option key={user.id} value={user.id}>{user.fullName || 'Unknown'}</option>)}</select></label><button className={ui.secondary} type="button" disabled={!assignee} onClick={() => void run('assign')}><UserRound size={15} aria-hidden="true" />Assign</button></div>
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2"><label className={`${ui.label} min-w-36 flex-1`}>Label<select value={label} onChange={event => setLabel(event.target.value)} className={ui.input}><option value="">Choose label</option>{labels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className={ui.secondary} type="button" disabled={!label} onClick={() => void run('addLabel')}><Tag size={15} aria-hidden="true" />Add label</button></div>
            {selectedIds.length > 1 && <button className={ui.danger} type="button" onClick={() => setMergeTarget(selectedIds[0])}><GitMerge size={16} aria-hidden="true" />Merge</button>}
        </fieldset>
        <Modal isOpen={mergeTarget !== null} onClose={mutation.busy ? undefined : () => setMergeTarget(null)} title="Merge Conversations">
            <p className={ui.alert}>This cannot be undone. Messages will move into the selected target; source conversations will be closed.</p>
            {mutation.error && <p className={ui.alert} role="alert">{mutation.error}</p>}
            <fieldset disabled={mutation.busy} className="min-w-0 space-y-3 my-4 disabled:opacity-70"><legend className={`${ui.title} mb-3`}>Target conversation</legend>{selectedIds.map(id => {
                const conversation = conversations.find(row => row.id === id);
                const name = [conversation?.customer || 'Conversation details unavailable', conversation?.subject || 'Subject not recorded', conversation?.channel, `Record ID: ${id}`].filter(Boolean).join(' · ');
                return <label key={id} className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3 ${mergeTarget === id ? 'border-[var(--primary-color)] bg-[var(--brand-subtle)]' : 'border-slate-200 dark:border-slate-700'}`}><input className={`${ui.checkbox} mt-1`} aria-label={name} type="radio" name="merge-target" value={id} checked={mergeTarget === id} onChange={() => setMergeTarget(id)} /><span className="min-w-0 space-y-1"><span className="block break-words text-sm font-semibold">{conversation?.customer || 'Conversation details unavailable'}</span><span className="block break-words text-sm text-slate-600 dark:text-slate-300">{conversation?.subject || 'Subject not recorded'}</span>{conversation?.channel && <span className={ui.badge}>{conversation.channel}</span>}<span className={`block break-all font-mono ${ui.muted}`}>Record ID: {id}</span></span></label>;
            })}</fieldset>
            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-700"><button className={ui.secondary} type="button" disabled={mutation.busy} onClick={() => setMergeTarget(null)}>Cancel merge</button><button className={ui.danger} type="button" disabled={locked || !mergeTarget} onClick={() => void run('merge')}><GitMerge size={16} aria-hidden="true" />{mutation.busy ? 'Merging...' : 'Merge Conversations'}</button></div>
        </Modal>
    </aside>;
}
