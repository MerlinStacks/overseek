/**
 * NotesSection - Conversation notes management component
 * 
 * Extracted from ContactPanel.tsx for improved modularity.
 * Handles fetching, adding, and deleting notes for a conversation.
 */

import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { Send, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface Note {
    id: string;
    content: string;
    createdAt: string;
    createdBy: { id: string; fullName?: string; avatarUrl?: string };
}

interface NotesSectionProps {
    conversationId: string;
}

// Module-level cache: show cached notes instantly, revalidate in background
const notesCache = new Map<string, Note[]>();

/**
 * Manages notes for a conversation with add/delete functionality.
 */
export function NotesSection({ conversationId }: NotesSectionProps) {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const [notes, setNotes] = useState<Note[]>(() => notesCache.get(conversationId) || []);
    const [newNote, setNewNote] = useState('');
    const [isAddingNote, setIsAddingNote] = useState(false);

    const fetchNotes = useCallback(async () => {
        if (!conversationId || !token) return;
        try {
            const res = await fetch(`/api/chat/conversations/${conversationId}/notes`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                setNotes(data);
                notesCache.set(conversationId, data);
            }
        } catch (e) {
            Logger.error('Failed to fetch notes:', { error: e });
        }
    }, [conversationId, token, currentAccount?.id]);

    useEffect(() => {
        // Show cached notes instantly
        const cached = notesCache.get(conversationId);
        if (cached) setNotes(cached);
        // Always revalidate in background
        fetchNotes();
    }, [fetchNotes, conversationId]);

    const addNote = async () => {
        if (!newNote.trim() || !conversationId) return;
        setIsAddingNote(true);
        try {
            const res = await fetch(`/api/chat/conversations/${conversationId}/notes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ content: newNote })
            });
            if (res.ok) {
                const note = await res.json();
                const updated = [note, ...notes];
                setNotes(updated);
                notesCache.set(conversationId, updated);
                setNewNote('');
            }
        } catch (e) {
            Logger.error('Failed to add note:', { error: e });
        } finally {
            setIsAddingNote(false);
        }
    };

    const deleteNote = async (noteId: string) => {
        if (!confirm('Delete this note?')) return;
        try {
            await fetch(`/api/chat/conversations/${conversationId}/notes/${noteId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            const updated = notes.filter(n => n.id !== noteId);
            setNotes(updated);
            notesCache.set(conversationId, updated);
        } catch (e) {
            Logger.error('Failed to delete note:', { error: e });
        }
    };

    return (
        <>
            {/* Add note form */}
            <div className="flex gap-2 mb-3">
                <input
                    type="text"
                    placeholder="Add a note..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addNote()}
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <button
                    onClick={addNote}
                    disabled={!newNote.trim() || isAddingNote}
                    className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Send size={14} />
                </button>
            </div>

            {/* Notes list */}
            {notes.length === 0 ? (
                <div className="text-sm text-gray-500 italic">No notes yet.</div>
            ) : (
                <div className="space-y-2">
                    {notes.map((note) => (
                        <div key={note.id} className="bg-yellow-50 border border-yellow-100 rounded-lg p-2 group">
                            <p className="text-sm text-gray-800">{note.content}</p>
                            <div className="flex items-center justify-between mt-1">
                                <span className="text-[10px] text-gray-500">
                                    {note.createdBy?.fullName || 'Agent'} · {format(new Date(note.createdAt), 'MMM d, h:mm a')}
                                </span>
                                {note.createdBy?.id === user?.id && (
                                    <button
                                        onClick={() => deleteNote(note.id)}
                                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 transition-opacity"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
