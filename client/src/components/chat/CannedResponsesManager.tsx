/**
 * CannedResponsesManager - Modal for quickly managing canned responses from inbox.
 * Includes rich text editing and label support.
 */
import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Zap, Tag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { RichTextEditor } from '../common/RichTextEditor';
import DOMPurify from 'dompurify';

interface CannedResponseLabel {
    id: string;
    name: string;
    color: string;
}

interface CannedResponse {
    id: string;
    shortcut: string;
    content: string;
    labelId: string | null;
    label: CannedResponseLabel | null;
}

interface CannedResponsesManagerProps {
    isOpen: boolean;
    onClose: () => void;
    onUpdate?: () => void;
}

export function CannedResponsesManager({ isOpen, onClose, onUpdate }: CannedResponsesManagerProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [responses, setResponses] = useState<CannedResponse[]>([]);
    const [labels, setLabels] = useState<CannedResponseLabel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [newShortcut, setNewShortcut] = useState('');
    const [newContent, setNewContent] = useState('');
    const [newLabelId, setNewLabelId] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen && currentAccount && token) {
            fetchResponses();
            fetchLabels();
        }
    }, [isOpen, currentAccount, token]);

    const fetchLabels = async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch('/api/chat/canned-labels', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                setLabels(await res.json());
            }
        } catch (e) {
            console.error('Failed to fetch labels', e);
        }
    };

    const fetchResponses = async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        try {
            const res = await fetch('/api/chat/canned-responses', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                setResponses(await res.json());
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newShortcut.trim() || !newContent.trim() || !currentAccount || !token) return;

        setIsSaving(true);
        try {
            const res = await fetch('/api/chat/canned-responses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    shortcut: newShortcut.trim(),
                    content: newContent.trim(),
                    labelId: newLabelId || null,
                    accountId: currentAccount.id
                })
            });

            if (res.ok) {
                const newResponse = await res.json();
                setResponses(prev => [...prev, newResponse]);
                setNewShortcut('');
                setNewContent('');
                setNewLabelId('');
                onUpdate?.();
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!token) return;

        try {
            const res = await fetch(`/api/chat/canned-responses/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (res.ok) {
                setResponses(prev => prev.filter(r => r.id !== id));
                onUpdate?.();
            }
        } catch (e) {
            console.error('Failed to delete', e);
        }
    };

    if (!isOpen) return null;

    // Group by label
    const grouped = responses.reduce((acc, r) => {
        const key = r.label?.name || 'Uncategorized';
        if (!acc[key]) acc[key] = { label: r.label, items: [] };
        acc[key].items.push(r);
        return acc;
    }, {} as Record<string, { label: CannedResponseLabel | null; items: CannedResponse[] }>);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                        <Zap className="text-blue-600" size={20} />
                        <h2 className="text-lg font-semibold text-gray-900">Canned Responses</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Add New Form */}
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Add New Response</h3>
                    <div className="flex gap-3 mb-3">
                        <div className="w-32">
                            <label className="block text-xs text-gray-500 mb-1">Shortcut</label>
                            <div className="flex items-center">
                                <span className="text-gray-400 mr-1">/</span>
                                <input
                                    type="text"
                                    value={newShortcut}
                                    onChange={(e) => setNewShortcut(e.target.value.replace(/\s/g, ''))}
                                    placeholder="hi"
                                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                                />
                            </div>
                        </div>
                        <div className="w-40">
                            <label className="block text-xs text-gray-500 mb-1">Label</label>
                            <select
                                value={newLabelId}
                                onChange={(e) => setNewLabelId(e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                            >
                                <option value="">No Label</option>
                                {labels.map(label => (
                                    <option key={label.id} value={label.id}>{label.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={handleAdd}
                                disabled={!newShortcut.trim() || !newContent.trim() || isSaving}
                                className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Plus size={16} />
                                {isSaving ? 'Adding...' : 'Add'}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Content (Rich Text)</label>
                        <RichTextEditor
                            value={newContent}
                            onChange={setNewContent}
                            placeholder="Hello! How can I help you today?"
                            variant="compact"
                        />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="p-8 text-center text-gray-500">Loading...</div>
                    ) : responses.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            <Zap size={32} className="mx-auto mb-2 opacity-50" />
                            <p>No canned responses yet</p>
                            <p className="text-sm">Add your first one above!</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {Object.entries(grouped).map(([name, { label, items }]) => (
                                <div key={name} className="px-6 py-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        {label ? (
                                            <div
                                                className="w-3 h-3 rounded-full"
                                                style={{ backgroundColor: label.color }}
                                            />
                                        ) : (
                                            <Tag size={12} className="text-gray-400" />
                                        )}
                                        <span className="text-xs font-medium text-gray-500 uppercase">{name}</span>
                                    </div>
                                    {items.map(response => (
                                        <div key={response.id} className="flex items-start gap-4 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
                                            <div className="shrink-0 pt-0.5">
                                                <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded-sm text-gray-600">
                                                    /{response.shortcut}
                                                </span>
                                            </div>
                                            <div
                                                className="flex-1 min-w-0 text-sm text-gray-700 prose prose-sm max-w-none line-clamp-2"
                                                dangerouslySetInnerHTML={{
                                                    __html: DOMPurify.sanitize(response.content, {
                                                        ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'p', 'br'],
                                                        ALLOWED_ATTR: []
                                                    })
                                                }}
                                            />
                                            <button
                                                onClick={() => handleDelete(response.id)}
                                                className="shrink-0 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
                    Type <code className="bg-gray-200 px-1 rounded-sm">/shortcut</code> in the reply box to use a canned response
                </div>
            </div>
        </div>
    );
}
