/** Account- and conversation-isolated note management. */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatDateTimeSafe } from '../../utils/format';

interface Note {
    id: string;
    content: string;
    createdAt: string;
    createdBy?: { id: string; fullName?: string; avatarUrl?: string } | null;
}

function isNote(value: unknown): value is Note {
    if (!value || typeof value !== 'object') return false;
    const note = value as Note;
    return typeof note.id === 'string' && typeof note.content === 'string' && typeof note.createdAt === 'string' &&
        (note.createdBy == null || typeof note.createdBy.id === 'string');
}

export function NotesSection({ conversationId }: { conversationId: string }) {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    if (!token || !user || !currentAccount || !conversationId) return <p role="status">Select an account and conversation to view notes.</p>;
    return <ConversationNotes key={JSON.stringify([user.id, currentAccount.id, conversationId, token])}
        token={token} userId={user.id} accountId={currentAccount.id} conversationId={conversationId} />;
}

function ConversationNotes({ token, userId, accountId, conversationId }: { token: string; userId: string; accountId: string; conversationId: string }) {
    // Keep notes local: a module-level cache can retain private content after logout.
    const [notes, setNotes] = useState<Note[]>([]);
    const [newNote, setNewNote] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
    const active = useRef(true);
    const pending = useRef(false);
    const loadRequest = useRef<AbortController | null>(null);
    const mutationRequest = useRef<AbortController | null>(null);
    const endpoint = `/api/chat/conversations/${encodeURIComponent(conversationId)}/notes`;

    const fetchNotes = useCallback(async () => {
        if (pending.current) return;
        loadRequest.current?.abort();
        const controller = new AbortController(); loadRequest.current = controller;
        setLoading(true);
        try {
            const response = await fetch(endpoint, { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId } });
            if (!response.ok) throw new Error('Could not load notes');
            const data = await response.json();
            if (!Array.isArray(data) || !data.every(isNote)) throw new Error('Invalid notes response');
            if (active.current && !controller.signal.aborted) { setNotes(data); setLoadError(false); }
        } catch {
            if (active.current && !controller.signal.aborted) setLoadError(true);
        } finally {
            if (active.current && !controller.signal.aborted) setLoading(false);
        }
    }, [endpoint, accountId, token]);

    useEffect(() => {
        active.current = true;
        let disposed = false;
        queueMicrotask(() => { if (!disposed) void fetchNotes(); });
        return () => { disposed = true; active.current = false; loadRequest.current?.abort(); mutationRequest.current?.abort(); };
    }, [fetchNotes]);

    const mutate = async (method: 'POST' | 'DELETE', noteId?: string) => {
        if (pending.current || loading || (method === 'POST' && !newNote.trim())) return;
        pending.current = true; setSaving(true); setActionError(null);
        loadRequest.current?.abort();
        const controller = new AbortController(); mutationRequest.current = controller;
        try {
            const response = await fetch(noteId ? `${endpoint}/${encodeURIComponent(noteId)}` : endpoint, {
                method, signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': accountId },
                ...(method === 'POST' ? { body: JSON.stringify({ content: newNote.trim() }) } : {})
            });
            if (!response.ok) throw new Error('Could not save note changes. Please try again.');
            const note = method === 'POST' ? await response.json() : null;
            if (method === 'POST' && !isNote(note)) throw new Error('The saved note could not be read. Reload notes before retrying.');
            if (!active.current || controller.signal.aborted) return;
            if (note) { setNotes(previous => [note, ...previous.filter(item => item.id !== note.id)]); setNewNote(''); }
            else setNotes(previous => previous.filter(item => item.id !== noteId));
            setConfirmingDeleteId(null);
        } catch (error) {
            if (active.current && !controller.signal.aborted) setActionError(error instanceof Error ? error.message : 'Could not save note changes.');
        } finally {
            pending.current = false;
            if (active.current) setSaving(false);
        }
    };

    return <section aria-label="Conversation notes" aria-busy={saving}>
        {actionError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
        {loadError && <p role="alert">Could not load notes. <button type="button" disabled={saving || loading} onClick={() => void fetchNotes()}>Retry notes</button></p>}
        {saving && <p role="status" className="text-sm">Saving note changes...</p>}
        <div className="flex gap-2 mb-3">
            <input type="text" aria-label="New conversation note" placeholder="Add a note..." value={newNote} disabled={saving || loading}
                onChange={event => setNewNote(event.target.value)} onKeyDown={event => {
                    if (event.key !== 'Enter' || event.repeat || event.nativeEvent.isComposing) return;
                    event.preventDefault(); void mutate('POST');
                }} className="min-w-0 flex-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            <button type="button" aria-label="Add note" onClick={() => void mutate('POST')} disabled={!newNote.trim() || saving || loading} className="p-1.5 bg-blue-600 text-white rounded-lg disabled:opacity-50"><Send size={14} aria-hidden="true" /></button>
        </div>
        {loading ? <p role="status">Loading notes...</p> : notes.length === 0 ? !loadError && <p className="text-sm text-gray-500 dark:text-slate-400 italic">No notes yet.</p> :
            <div className="space-y-2">{notes.map(note => <div key={note.id} className="bg-yellow-50 dark:bg-amber-950/30 border border-yellow-100 dark:border-amber-900 rounded-lg p-2">
                <p className="text-sm text-gray-800 dark:text-slate-100 break-words">{note.content}</p>
                <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="text-xs text-gray-500 dark:text-slate-400">{note.createdBy?.fullName || 'Agent'} · {formatDateTimeSafe(note.createdAt, 'Date unavailable')}</span>
                    {note.createdBy?.id === userId && (confirmingDeleteId === note.id ? <div className="flex gap-2">
                        <button type="button" disabled={saving} onClick={() => void mutate('DELETE', note.id)} className="text-xs text-red-600 dark:text-red-400">Delete note?</button>
                        <button type="button" disabled={saving} onClick={() => setConfirmingDeleteId(null)} className="text-xs text-gray-500 dark:text-slate-400">Cancel</button>
                    </div> : <button type="button" disabled={saving} aria-label={`Delete note: ${note.content}`} onClick={() => setConfirmingDeleteId(note.id)} className="p-1 text-gray-500 dark:text-slate-400 hover:text-red-600"><Trash2 size={14} aria-hidden="true" /></button>)}
                </div>
            </div>)}</div>}
    </section>;
}
