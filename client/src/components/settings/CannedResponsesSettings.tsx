/**
 * Canned Responses Settings Component.
 * Full CRUD interface for managing canned response templates with labels (rich text).
 */
import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { Tag, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { cn } from '../../utils/cn';
import { CannedResponseLabelManager, CannedResponseLabel } from './CannedResponseLabelManager';
import { CannedResponseForm } from './CannedResponseForm';
import { CannedResponseList, CannedResponse } from './CannedResponseList';

export function CannedResponsesSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [responses, setResponses] = useState<CannedResponse[]>([]);
    const [labels, setLabels] = useState<CannedResponseLabel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [formData, setFormData] = useState({ shortcut: '', content: '', labelId: '' });
    const [showLabelManager, setShowLabelManager] = useState(false);
    const [newLabelName, setNewLabelName] = useState('');
    const [newLabelColor, setNewLabelColor] = useState('#6366f1');
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);

    const fetchLabels = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch('/api/chat/canned-labels', {
                headers: { 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount.id }
            });
            if (res.ok) setLabels(await res.json());
        } catch (error) { Logger.error('Failed to fetch labels:', { error }); }
    }, [currentAccount, token]);

    const fetchResponses = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        try {
            const res = await fetch('/api/chat/canned-responses', {
                headers: { 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount.id }
            });
            if (res.ok) setResponses(await res.json());
        } catch (error) { Logger.error('Failed to fetch canned responses:', { error }); }
        finally { setIsLoading(false); }
    }, [currentAccount, token]);

    useEffect(() => { fetchLabels(); fetchResponses(); }, [fetchLabels, fetchResponses]);

    const handleSave = async () => {
        if (!formData.shortcut.trim() || !formData.content.trim()) return;
        const payload = { shortcut: formData.shortcut.trim(), content: formData.content.trim(), labelId: formData.labelId || null };
        try {
            const res = await fetch(editingId ? `/api/chat/canned-responses/${editingId}` : '/api/chat/canned-responses', {
                method: editingId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' },
                body: JSON.stringify(payload)
            });
            if (res.ok) { setFormData({ shortcut: '', content: '', labelId: '' }); setEditingId(null); fetchResponses(); }
        } catch (error) { Logger.error('Failed to save canned response:', { error }); }
    };

    const handleEdit = (response: CannedResponse) => {
        setEditingId(response.id);
        setFormData({ shortcut: response.shortcut, content: response.content, labelId: response.labelId || '' });
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this canned response?')) return;
        try {
            await fetch(`/api/chat/canned-responses/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' } });
            fetchResponses();
        } catch (error) { Logger.error('Failed to delete:', { error }); }
    };

    const handleCreateLabel = async () => {
        if (!newLabelName.trim()) return;
        try {
            const res = await fetch('/api/chat/canned-labels', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' },
                body: JSON.stringify({ name: newLabelName.trim(), color: newLabelColor })
            });
            if (res.ok) { setNewLabelName(''); setNewLabelColor('#6366f1'); fetchLabels(); }
            else { const err = await res.json(); alert(err.error || 'Failed to create label'); }
        } catch (error) { Logger.error('Failed to create label:', { error }); }
    };

    const handleUpdateLabel = async (id: string, name: string, color: string) => {
        try {
            await fetch(`/api/chat/canned-labels/${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' },
                body: JSON.stringify({ name, color })
            });
            setEditingLabelId(null); fetchLabels(); fetchResponses();
        } catch (error) { Logger.error('Failed to update label:', { error }); }
    };

    const handleDeleteLabel = async (id: string) => {
        if (!confirm('Delete this label? Responses will keep their content but lose this label.')) return;
        try {
            await fetch(`/api/chat/canned-labels/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' } });
            fetchLabels(); fetchResponses();
        } catch (error) { Logger.error('Failed to delete label:', { error }); }
    };

    // Group and filter responses
    const groupedResponses = responses.reduce((acc, response) => {
        const labelName = response.label?.name || 'Uncategorized';
        if (!acc[labelName]) acc[labelName] = { label: response.label, items: [] };
        acc[labelName].items.push(response);
        return acc;
    }, {} as Record<string, { label: CannedResponseLabel | null; items: CannedResponse[] }>);

    const filteredGroups = Object.entries(groupedResponses)
        .map(([name, { label, items }]) => ({
            name, label,
            items: items.filter(r => r.shortcut.toLowerCase().includes(searchQuery.toLowerCase()) || r.content.toLowerCase().includes(searchQuery.toLowerCase()))
        }))
        .filter(g => g.items.length > 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Canned Responses</h2>
                    <p className="text-sm text-gray-500">Create reusable rich text templates. Type "/" in the chat to use them.</p>
                </div>
                <button onClick={() => setShowLabelManager(!showLabelManager)} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors", showLabelManager ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}>
                    <Tag size={14} />Manage Labels
                </button>
            </div>

            {showLabelManager && (
                <CannedResponseLabelManager
                    labels={labels} editingLabelId={editingLabelId} newLabelName={newLabelName} newLabelColor={newLabelColor}
                    onLabelsChange={setLabels} onEditingLabelIdChange={setEditingLabelId} onNewLabelNameChange={setNewLabelName} onNewLabelColorChange={setNewLabelColor}
                    onCreateLabel={handleCreateLabel} onUpdateLabel={handleUpdateLabel} onDeleteLabel={handleDeleteLabel} onRefreshLabels={fetchLabels}
                />
            )}

            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Search responses..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
            </div>

            <CannedResponseForm formData={formData} labels={labels} editingId={editingId} onFormChange={setFormData} onSave={handleSave}
                onCancel={() => { setEditingId(null); setFormData({ shortcut: '', content: '', labelId: '' }); }} />

            <CannedResponseList groups={filteredGroups} editingId={editingId} isLoading={isLoading} searchQuery={searchQuery} onEdit={handleEdit} onDelete={handleDelete} />
        </div>
    );
}
