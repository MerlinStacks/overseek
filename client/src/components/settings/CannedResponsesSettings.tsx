/** Account-isolated canned-response and label management. */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Tag, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { CannedResponseLabelManager, type CannedResponseLabel } from './CannedResponseLabelManager';
import { CannedResponseForm } from './CannedResponseForm';
import { CannedResponseList, type CannedResponse } from './CannedResponseList';
import { Toast, type ToastType } from '../ui/Toast';

export function CannedResponsesSettings({ onUpdate }: { onUpdate?: () => void } = {}) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to manage canned responses.</p>;
    return <CannedResponsesContent key={JSON.stringify([currentAccount.id, token])} accountId={currentAccount.id} token={token} onUpdate={onUpdate} />;
}

function CannedResponsesContent({ accountId, token, onUpdate }: { accountId: string; token: string; onUpdate?: () => void }) {
    const [responses, setResponses] = useState<CannedResponse[]>([]);
    const [labels, setLabels] = useState<CannedResponseLabel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadErrors, setLoadErrors] = useState<{ responses?: string; labels?: string }>({});
    const [editingId, setEditingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [formData, setFormData] = useState({ shortcut: '', content: '', labelId: '' });
    const [showLabelManager, setShowLabelManager] = useState(false);
    const [newLabelName, setNewLabelName] = useState('');
    const [newLabelColor, setNewLabelColor] = useState('#6366f1');
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: ToastType; visible: boolean }>({ message: '', type: 'error', visible: false });
    const [isSaving, setIsSaving] = useState(false);
    const active = useRef(true);
    const pending = useRef(false);
    const requests = useRef<{ responses?: AbortController; labels?: AbortController; mutation?: AbortController }>({});
    const showToast = (message: string, type: ToastType = 'error') => setToast({ message, type, visible: true });

    const load = useCallback(async (kind: 'responses' | 'labels') => {
        requests.current[kind]?.abort();
        const controller = new AbortController(); requests.current[kind] = controller;
        if (kind === 'responses') setIsLoading(true);
        try {
            const res = await fetch(`/api/chat/${kind === 'labels' ? 'canned-labels' : 'canned-responses'}`, {
                signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId },
            });
            if (!res.ok) throw new Error('Load failed');
            const data = await res.json();
            if (!Array.isArray(data) || !data.every(value => value && typeof value.id === 'string' && (kind === 'labels'
                ? typeof value.name === 'string' && typeof value.color === 'string'
                : typeof value.shortcut === 'string' && typeof value.content === 'string' && (value.label == null || typeof value.label.name === 'string')))) throw new Error('Invalid response');
            if (!active.current || controller.signal.aborted) return;
            if (kind === 'responses') setResponses(data); else setLabels(data);
            setLoadErrors(previous => ({ ...previous, [kind]: undefined }));
        } catch {
            if (active.current && !controller.signal.aborted) setLoadErrors(previous => ({ ...previous, [kind]: `Could not load ${kind}.` }));
        } finally {
            if (active.current && !controller.signal.aborted && kind === 'responses') setIsLoading(false);
        }
    }, [accountId, token]);

    useEffect(() => {
        active.current = true;
        let disposed = false;
        queueMicrotask(() => { if (!disposed) { void load('labels'); void load('responses'); } });
        const current = requests.current;
        return () => { disposed = true; active.current = false; Object.values(current).forEach(controller => controller?.abort()); };
    }, [load]);

    const mutate = async (url: string, method: string, body: unknown, success: () => void) => {
        if (pending.current) return;
        pending.current = true; setIsSaving(true);
        const controller = new AbortController(); requests.current.mutation = controller;
        try {
            const res = await fetch(url, {
                method, signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': accountId },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not save changes. Please try again.');
            if (active.current && !controller.signal.aborted) {
                success();
                try { void Promise.resolve(onUpdate?.()).catch(() => {}); } catch { /* A refresh callback must not turn a saved mutation into a retry. */ }
            }
        } catch (error) {
            if (active.current && !controller.signal.aborted) showToast(error instanceof Error ? error.message : 'Request failed. Please try again.');
        } finally {
            pending.current = false; if (active.current) setIsSaving(false);
        }
    };

    const handleSave = () => {
        if (!formData.shortcut.trim()) { showToast('Shortcut is required'); return; }
        if (!formData.content.trim()) { showToast('Response content is required'); return; }
        void mutate(editingId ? `/api/chat/canned-responses/${encodeURIComponent(editingId)}` : '/api/chat/canned-responses', editingId ? 'PUT' : 'POST',
            { shortcut: formData.shortcut.trim(), content: formData.content.trim(), labelId: formData.labelId || null }, () => {
                setFormData({ shortcut: '', content: '', labelId: '' }); setEditingId(null); void load('responses'); showToast('Canned response saved', 'success');
            });
    };
    const handleDelete = (id: string) => {
        if (!confirm('Delete this canned response?')) return;
        void mutate(`/api/chat/canned-responses/${encodeURIComponent(id)}`, 'DELETE', undefined, () => { void load('responses'); showToast('Canned response deleted', 'success'); });
    };
    const refreshLabels = () => { void load('labels'); void load('responses'); };
    const createLabel = () => {
        if (!newLabelName.trim()) { showToast('Label name is required'); return; }
        void mutate('/api/chat/canned-labels', 'POST', { name: newLabelName.trim(), color: newLabelColor }, () => {
            setNewLabelName(''); setNewLabelColor('#6366f1'); refreshLabels(); showToast('Label created', 'success');
        });
    };
    const groups = new Map<string, { label: CannedResponseLabel | null; items: CannedResponse[] }>();
    for (const response of responses) {
        const name = response.label?.name || 'Uncategorized';
        const group = groups.get(name) || { label: response.label, items: [] };
        group.items.push(response); groups.set(name, group);
    }
    const query = searchQuery.trim().toLowerCase();
    const filteredGroups = [...groups].map(([name, group]) => ({ name, label: group.label, items: group.items.filter(response => response.shortcut.toLowerCase().includes(query) || response.content.toLowerCase().includes(query)) })).filter(group => group.items.length);

    return <div className="space-y-6" aria-busy={isSaving}>
        {isSaving && <p role="status">Saving changes...</p>}
        {Object.values(loadErrors).filter(Boolean).map(message => <p role="alert" key={message}>{message} <button type="button" onClick={refreshLabels}>Retry loading</button></p>)}
        <fieldset disabled={isSaving} inert={isSaving} className="space-y-6">
            <div className="flex flex-wrap gap-3 items-center justify-between">
                <div><h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Canned Responses</h2><p className="text-sm text-gray-500">Create reusable rich text templates. Type "/" in the chat to use them.</p></div>
                <button type="button" aria-expanded={showLabelManager} onClick={() => setShowLabelManager(!showLabelManager)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-100 text-indigo-700"><Tag size={14} />Manage Labels</button>
            </div>
            {showLabelManager && <CannedResponseLabelManager
                labels={labels} editingLabelId={editingLabelId} newLabelName={newLabelName} newLabelColor={newLabelColor}
                onLabelsChange={setLabels} onEditingLabelIdChange={setEditingLabelId} onNewLabelNameChange={setNewLabelName} onNewLabelColorChange={setNewLabelColor}
                onCreateLabel={createLabel} onUpdateLabel={(id, name, color) => {
                    if (!name.trim()) { showToast('Label name is required'); return; }
                    void mutate(`/api/chat/canned-labels/${encodeURIComponent(id)}`, 'PUT', { name: name.trim(), color }, () => { setEditingLabelId(null); refreshLabels(); showToast('Label updated', 'success'); });
                }} onDeleteLabel={id => {
                    if (confirm('Delete this label? Responses will keep their content but lose this label.')) void mutate(`/api/chat/canned-labels/${encodeURIComponent(id)}`, 'DELETE', undefined, () => { refreshLabels(); showToast('Label deleted', 'success'); });
                }} onRefreshLabels={refreshLabels}
            />}
            <div className="relative"><Search aria-hidden="true" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input aria-label="Search canned responses" placeholder="Search responses..." value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm dark:bg-slate-800" /></div>
            <CannedResponseForm formData={formData} labels={labels} editingId={editingId} onFormChange={setFormData} onSave={handleSave} onCancel={() => { setEditingId(null); setFormData({ shortcut: '', content: '', labelId: '' }); }} />
            <CannedResponseList groups={filteredGroups} editingId={editingId} isLoading={isLoading} searchQuery={searchQuery} onEdit={response => { setEditingId(response.id); setFormData({ shortcut: response.shortcut, content: response.content, labelId: response.labelId || '' }); }} onDelete={handleDelete} />
        </fieldset>
        <Toast message={toast.message} isVisible={toast.visible} onClose={() => setToast(previous => ({ ...previous, visible: false }))} type={toast.type} />
    </div>;
}
