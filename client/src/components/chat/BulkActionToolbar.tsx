import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { api } from '../../services/api';
import { isRecord } from '../../utils/responseValidation';
import { Modal } from '../ui/Modal';

interface Props {
    selectedIds: string[]; onClearSelection: () => void; onActionComplete: () => void;
    users?: { id: string; fullName: string }[];
    labels?: { id: string; name: string; color: string }[];
}
export function BulkActionToolbar(props: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    const ids = [...new Set(props.selectedIds)].sort();
    if (!ids.length) return null;
    if (!token || !currentAccount || !ids.every(id => typeof id === 'string' && id.trim())) return <p role="alert">Select an account and valid conversations before applying bulk actions.</p>;
    return <ScopedToolbar key={JSON.stringify([token, currentAccount.id, ids])} {...props} selectedIds={ids} token={token} accountId={currentAccount.id} />;
}
function ScopedToolbar({ selectedIds, onClearSelection, onActionComplete, users = [], labels = [], token, accountId }: Props & { token: string; accountId: string }) {
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
    return <aside aria-label="Bulk conversation actions" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-3xl p-4 space-y-3 rounded-xl bg-slate-900 text-white border border-slate-700 shadow-xl">
        <div className="flex justify-between gap-3"><p>{selectedIds.length} selected</p><button type="button" disabled={mutation.busy} onClick={onClearSelection}>Clear selection</button></div>
        {mutation.error && <p role="alert">{mutation.error}</p>}{feedback && <p role="status">{feedback}</p>}{mutation.busy && <p role="status">Applying bulk operation...</p>}
        <fieldset disabled={locked} className="flex flex-wrap items-end gap-3">
            <button type="button" onClick={() => void run('close')}>Close</button><button type="button" onClick={() => void run('open')}>Reopen</button>
            <label>Assignee<select value={assignee} onChange={event => setAssignee(event.target.value)} className="block bg-slate-800 p-2 rounded-lg"><option value="">Choose team member</option>{users.map(user => <option key={user.id} value={user.id}>{user.fullName || 'Unknown'}</option>)}</select></label><button type="button" disabled={!assignee} onClick={() => void run('assign')}>Assign</button>
            <label>Label<select value={label} onChange={event => setLabel(event.target.value)} className="block bg-slate-800 p-2 rounded-lg"><option value="">Choose label</option>{labels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" disabled={!label} onClick={() => void run('addLabel')}>Add label</button>
            {selectedIds.length > 1 && <button type="button" onClick={() => setMergeTarget(selectedIds[0])}>Merge</button>}
        </fieldset>
        <Modal isOpen={mergeTarget !== null} onClose={mutation.busy ? undefined : () => setMergeTarget(null)} title="Merge Conversations">
            <p>This cannot be undone. Messages will move into the selected target; source conversations will be closed.</p>
            {mutation.error && <p role="alert">{mutation.error}</p>}
            <fieldset disabled={mutation.busy} className="space-y-3 my-4"><legend>Target conversation</legend>{selectedIds.map(id => <label key={id} className="flex gap-2"><input type="radio" name="merge-target" value={id} checked={mergeTarget === id} onChange={() => setMergeTarget(id)} />Conversation {id}</label>)}</fieldset>
            <button type="button" disabled={locked || !mergeTarget} onClick={() => void run('merge')}>{mutation.busy ? 'Merging...' : 'Merge Conversations'}</button>
        </Modal>
    </aside>;
}
