/**
 * Canned Responses Settings Component.
 * Full CRUD interface for managing canned response templates with labels (rich text).
 */
import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { Plus, Trash2, Edit2, Save, X, Zap, Tag, Search, Palette } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { cn } from '../../utils/cn';
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

export function CannedResponsesSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [responses, setResponses] = useState<CannedResponse[]>([]);
    const [labels, setLabels] = useState<CannedResponseLabel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Form state
    const [formData, setFormData] = useState({
        shortcut: '',
        content: '',
        labelId: ''
    });

    // Label management state
    const [showLabelManager, setShowLabelManager] = useState(false);
    const [newLabelName, setNewLabelName] = useState('');
    const [newLabelColor, setNewLabelColor] = useState('#6366f1');
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);

    const fetchLabels = useCallback(async () => {
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
        } catch (error) {
            Logger.error('Failed to fetch labels:', { error: error });
        }
    }, [currentAccount, token]);

    const fetchResponses = useCallback(async () => {
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
        } catch (error) {
            Logger.error('Failed to fetch canned responses:', { error: error });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchLabels();
        fetchResponses();
    }, [fetchLabels, fetchResponses]);

    const handleSave = async () => {
        if (!formData.shortcut.trim() || !formData.content.trim()) return;

        const payload = {
            shortcut: formData.shortcut.trim(),
            content: formData.content.trim(),
            labelId: formData.labelId || null
        };

        try {
            const method = editingId ? 'PUT' : 'POST';
            const url = editingId
                ? `/api/chat/canned-responses/${editingId}`
                : '/api/chat/canned-responses';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                setFormData({ shortcut: '', content: '', labelId: '' });
                setEditingId(null);
                fetchResponses();
            }
        } catch (error) {
            Logger.error('Failed to save canned response:', { error: error });
        }
    };

    const handleEdit = (response: CannedResponse) => {
        setEditingId(response.id);
        setFormData({
            shortcut: response.shortcut,
            content: response.content,
            labelId: response.labelId || ''
        });
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this canned response?')) return;
        try {
            await fetch(`/api/chat/canned-responses/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            fetchResponses();
        } catch (error) {
            Logger.error('Failed to delete:', { error: error });
        }
    };

    const handleCancel = () => {
        setEditingId(null);
        setFormData({ shortcut: '', content: '', labelId: '' });
    };

    // Label CRUD
    const handleCreateLabel = async () => {
        if (!newLabelName.trim()) return;
        try {
            const res = await fetch('/api/chat/canned-labels', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ name: newLabelName.trim(), color: newLabelColor })
            });
            if (res.ok) {
                setNewLabelName('');
                setNewLabelColor('#6366f1');
                fetchLabels();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to create label');
            }
        } catch (error) {
            Logger.error('Failed to create label:', { error: error });
        }
    };

    const handleUpdateLabel = async (id: string, name: string, color: string) => {
        try {
            await fetch(`/api/chat/canned-labels/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ name, color })
            });
            setEditingLabelId(null);
            fetchLabels();
            fetchResponses(); // Refresh to get updated label info
        } catch (error) {
            Logger.error('Failed to update label:', { error: error });
        }
    };

    const handleDeleteLabel = async (id: string) => {
        if (!confirm('Delete this label? Responses will keep their content but lose this label.')) return;
        try {
            await fetch(`/api/chat/canned-labels/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            fetchLabels();
            fetchResponses();
        } catch (error) {
            Logger.error('Failed to delete label:', { error: error });
        }
    };

    // Group responses by label
    const groupedResponses = responses.reduce((acc, response) => {
        const labelName = response.label?.name || 'Uncategorized';
        if (!acc[labelName]) acc[labelName] = { label: response.label, items: [] };
        acc[labelName].items.push(response);
        return acc;
    }, {} as Record<string, { label: CannedResponseLabel | null; items: CannedResponse[] }>);

    // Filter by search
    const filteredGroups = Object.entries(groupedResponses)
        .map(([name, { label, items }]) => ({
            name,
            label,
            items: items.filter(r =>
                r.shortcut.toLowerCase().includes(searchQuery.toLowerCase()) ||
                r.content.toLowerCase().includes(searchQuery.toLowerCase())
            )
        }))
        .filter(g => g.items.length > 0);

    const PRESET_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Canned Responses</h2>
                    <p className="text-sm text-gray-500">
                        Create reusable rich text templates. Type "/" in the chat to use them.
                    </p>
                </div>
                <button
                    onClick={() => setShowLabelManager(!showLabelManager)}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                        showLabelManager
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    )}
                >
                    <Tag size={14} />
                    Manage Labels
                </button>
            </div>

            {/* Label Manager Panel */}
            {showLabelManager && (
                <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-200">
                    <h3 className="text-sm font-medium text-indigo-900 mb-3">Labels</h3>

                    {/* Existing Labels */}
                    <div className="space-y-2 mb-4">
                        {labels.map(label => (
                            <div key={label.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-indigo-100">
                                {editingLabelId === label.id ? (
                                    <>
                                        <input
                                            type="color"
                                            value={label.color}
                                            onChange={(e) => {
                                                setLabels(labels.map(l => l.id === label.id ? { ...l, color: e.target.value } : l));
                                            }}
                                            className="w-6 h-6 rounded cursor-pointer"
                                        />
                                        <input
                                            type="text"
                                            value={label.name}
                                            onChange={(e) => {
                                                setLabels(labels.map(l => l.id === label.id ? { ...l, name: e.target.value } : l));
                                            }}
                                            className="flex-1 px-2 py-1 border rounded text-sm"
                                        />
                                        <button
                                            onClick={() => handleUpdateLabel(label.id, label.name, label.color)}
                                            className="p-1 text-green-600 hover:bg-green-50 rounded"
                                        >
                                            <Save size={14} />
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingLabelId(null);
                                                fetchLabels(); // Reset to original
                                            }}
                                            className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                                        >
                                            <X size={14} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div
                                            className="w-4 h-4 rounded-full"
                                            style={{ backgroundColor: label.color }}
                                        />
                                        <span className="flex-1 text-sm text-gray-700">{label.name}</span>
                                        <button
                                            onClick={() => setEditingLabelId(label.id)}
                                            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteLabel(label.id)}
                                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </>
                                )}
                            </div>
                        ))}
                        {labels.length === 0 && (
                            <p className="text-sm text-indigo-600 italic">No labels yet. Create one below.</p>
                        )}
                    </div>

                    {/* Create New Label */}
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <button
                                className="w-8 h-8 rounded-lg border-2 border-dashed border-indigo-300 flex items-center justify-center hover:border-indigo-400"
                                style={{ backgroundColor: newLabelColor }}
                                onClick={(e) => {
                                    const input = document.getElementById('new-label-color');
                                    input?.click();
                                }}
                            >
                                <Palette size={14} className="text-white drop-shadow" />
                            </button>
                            <input
                                id="new-label-color"
                                type="color"
                                value={newLabelColor}
                                onChange={(e) => setNewLabelColor(e.target.value)}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                        </div>
                        <div className="flex gap-1">
                            {PRESET_COLORS.map(color => (
                                <button
                                    key={color}
                                    onClick={() => setNewLabelColor(color)}
                                    className={cn(
                                        "w-5 h-5 rounded-full transition-transform",
                                        newLabelColor === color && "ring-2 ring-offset-1 ring-indigo-500 scale-110"
                                    )}
                                    style={{ backgroundColor: color }}
                                />
                            ))}
                        </div>
                        <input
                            type="text"
                            placeholder="New label name..."
                            value={newLabelName}
                            onChange={(e) => setNewLabelName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateLabel()}
                            className="flex-1 px-3 py-1.5 border border-indigo-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                        />
                        <button
                            onClick={handleCreateLabel}
                            disabled={!newLabelName.trim()}
                            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                        >
                            <Plus size={14} />
                            Add
                        </button>
                    </div>
                </div>
            )}

            {/* Search */}
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="text"
                    placeholder="Search responses..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
            </div>

            {/* Add/Edit Form */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                    {editingId ? 'Edit Response' : 'Add New Response'}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Shortcut</label>
                        <input
                            type="text"
                            placeholder="e.g. hi, refund, shipping"
                            value={formData.shortcut}
                            onChange={(e) => setFormData({ ...formData, shortcut: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
                        <select
                            value={formData.labelId}
                            onChange={(e) => setFormData({ ...formData, labelId: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        >
                            <option value="">No Label</option>
                            {labels.map(label => (
                                <option key={label.id} value={label.id}>
                                    {label.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-end gap-2">
                        <button
                            onClick={handleSave}
                            disabled={!formData.shortcut.trim() || !formData.content.trim()}
                            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {editingId ? <Save size={14} /> : <Plus size={14} />}
                            {editingId ? 'Save' : 'Add'}
                        </button>
                        {editingId && (
                            <button
                                onClick={handleCancel}
                                className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                            >
                                <X size={14} />
                                Cancel
                            </button>
                        )}
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Content (Rich Text)</label>
                    <RichTextEditor
                        value={formData.content}
                        onChange={(val) => setFormData({ ...formData, content: val })}
                        placeholder="Type your response here... Use {{customer.firstName}} for placeholders."
                        variant="standard"
                    />
                </div>
                <div className="mt-3 bg-amber-50 rounded-lg p-3 border border-amber-200">
                    <div className="flex items-start gap-2">
                        <Zap size={14} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-xs">
                            <p className="font-medium text-amber-800 mb-2">Available Merge Tags</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-amber-700">
                                <div><code className="bg-amber-100 px-1 rounded">{'{{customer.firstName}}'}</code> Customer's first name</div>
                                <div><code className="bg-amber-100 px-1 rounded">{'{{customer.lastName}}'}</code> Last name</div>
                                <div><code className="bg-amber-100 px-1 rounded">{'{{customer.name}}'}</code> Full name</div>
                                <div><code className="bg-amber-100 px-1 rounded">{'{{customer.email}}'}</code> Email address</div>
                                <div><code className="bg-amber-100 px-1 rounded">{'{{customer.greeting}}'}</code> "Hi John" or "Hi there"</div>
                                <div><code className="bg-amber-100 px-1 rounded">{'{{customer.ordersCount}}'}</code> Number of orders</div>
                                <div><code className="bg-amber-100 px-1 rounded">{'{{customer.totalSpent}}'}</code> Lifetime spend</div>
                                <div><code className="bg-amber-100 px-1 rounded">{'{{agent.firstName}}'}</code> Your first name</div>
                                <div><code className="bg-amber-100 px-1 rounded">{'{{agent.fullName}}'}</code> Your full name</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Responses List */}
            {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : filteredGroups.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    {searchQuery ? 'No responses match your search.' : 'No canned responses yet. Add your first one above!'}
                </div>
            ) : (
                <div className="space-y-6">
                    {filteredGroups.map(({ name, label, items }) => (
                        <div key={name}>
                            <div className="flex items-center gap-2 mb-2">
                                {label ? (
                                    <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: label.color }}
                                    />
                                ) : (
                                    <Tag size={14} className="text-gray-400" />
                                )}
                                <h4 className="text-sm font-medium text-gray-700">{name}</h4>
                                <span className="text-xs text-gray-400">({items.length})</span>
                            </div>
                            <div className="space-y-2">
                                {items.map((response) => (
                                    <div
                                        key={response.id}
                                        className={cn(
                                            "bg-white border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition-colors",
                                            editingId === response.id && "ring-2 ring-blue-500/20 border-blue-500"
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <code className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-mono">
                                                        /{response.shortcut}
                                                    </code>
                                                    {response.label && (
                                                        <span
                                                            className="px-1.5 py-0.5 rounded text-xs text-white"
                                                            style={{ backgroundColor: response.label.color }}
                                                        >
                                                            {response.label.name}
                                                        </span>
                                                    )}
                                                </div>
                                                <div
                                                    className="text-sm text-gray-600 line-clamp-2 prose prose-sm max-w-none"
                                                    dangerouslySetInnerHTML={{
                                                        __html: DOMPurify.sanitize(response.content, {
                                                            ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li', 'a'],
                                                            ALLOWED_ATTR: ['href', 'target']
                                                        })
                                                    }}
                                                />
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={() => handleEdit(response)}
                                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                                    title="Edit"
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(response.id)}
                                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
