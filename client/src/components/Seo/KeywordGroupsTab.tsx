/**
 * KeywordGroupsTab — Manage keyword groups and assign keywords.
 *
 * Shows group list with color swatches and aggregate metrics,
 * a create-group form, and keyword assignment controls.
 */

import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import {
    FolderOpen, Plus, Trash2, Loader2, X, Tag
} from 'lucide-react';
import {
    useKeywordGroups,
    useCreateGroup,
    useDeleteGroup,
    useAssignKeywordsToGroup,
    useTrackedKeywords,
} from '../../hooks/useSeoKeywords';
import type { KeywordGroup, TrackedKeywordSummary } from '../../hooks/useSeoKeywords';

const GROUP_COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#ef4444', '#06b6d4', '#f97316',
];

export function KeywordGroupsTab() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    if (!currentAccount || !token) return <p role="status">Select an account to manage keyword groups.</p>;
    return <KeywordGroupsContent key={JSON.stringify([currentAccount.id, token])} />;
}

function KeywordGroupsContent() {
    const { data: groupsData, isLoading: groupsLoading, error: groupError, refetch: reloadGroups } = useKeywordGroups();
    const { data: keywordsData, error: keywordError, refetch: reloadKeywords } = useTrackedKeywords();
    const createGroup = useCreateGroup();
    const deleteGroup = useDeleteGroup();
    const assignKeywords = useAssignKeywordsToGroup();

    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [selectedColor, setSelectedColor] = useState(GROUP_COLORS[0]);
    const [assigningGroup, setAssigningGroup] = useState<string | null>(null);
    const [selectedKeywordIds, setSelectedKeywordIds] = useState<string[]>([]);
    const [actionError, setActionError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const pending = useRef(false);
    const active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    const mutate = async (work: () => Promise<unknown>, success: () => void) => {
        if (pending.current) return;
        pending.current = true; setSaving(true); setActionError(null);
        try { await work(); if (active.current) success(); }
        catch { if (active.current) setActionError('Could not save keyword group changes. Please try again.'); }
        finally { pending.current = false; if (active.current) setSaving(false); }
    };

    const groups = groupsData?.groups || [];
    const keywords = keywordsData?.keywords || [];

    const handleCreate = async () => {
        if (!newName.trim()) return;
        await mutate(() => createGroup.mutateAsync({ name: newName.trim(), color: selectedColor }), () => {
            setNewName(''); setShowCreate(false);
        });
    };

    const handleAssign = async (groupId: string | null) => {
        if (selectedKeywordIds.length === 0) return;
        await mutate(() => assignKeywords.mutateAsync({ keywordIds: selectedKeywordIds, groupId }), () => {
            setSelectedKeywordIds([]); setAssigningGroup(null);
        });
    };

    const toggleKeyword = (id: string) => {
        setSelectedKeywordIds(prev =>
            prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]
        );
    };

    return (
        <div className="space-y-6 animate-fade-slide-up">
            {actionError && <p role="alert" className="text-red-700 dark:text-red-300">{actionError}</p>}
            {(groupError || keywordError) && <p role="alert">Could not load keyword groups or keywords. <button type="button" onClick={() => { void reloadGroups(); void reloadKeywords(); }}>Retry loading</button></p>}
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Keyword Groups</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Organize keywords into groups for easier tracking
                    </p>
                </div>
                <button
                    type="button" disabled={saving} aria-expanded={showCreate}
                    onClick={() => setShowCreate(!showCreate)}
                    className="btn-gradient btn-shimmer flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl font-semibold"
                >
                    <Plus className="w-4 h-4" />
                    New Group
                </button>
            </div>

            {/* Create Form */}
            {showCreate && (
                <div className="glass-panel rounded-xl p-4 space-y-3 animate-fade-slide-up">
                    <div className="flex items-center gap-3">
                        <input
                            aria-label="Group name" disabled={saving}
                            type="text"
                            placeholder="Group name (e.g. Brand Keywords)"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={event => {
                                if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.repeat) return;
                                event.preventDefault(); void handleCreate();
                            }}
                            className="input-premium flex-1 bg-transparent text-sm"
                            autoFocus
                        />
                        <button
                            type="button"
                            onClick={handleCreate}
                            disabled={!newName.trim() || createGroup.isPending || saving}
                            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                        >
                            {createGroup.isPending ? 'Creating...' : 'Create'}
                        </button>
                        <button type="button" disabled={saving} aria-label="Cancel creating group" onClick={() => { setShowCreate(false); setNewName(''); }} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Color:</span>
                        {GROUP_COLORS.map(c => (
                            <button
                                type="button" disabled={saving} aria-label={`Use color ${c}`} aria-pressed={selectedColor === c}
                                key={c}
                                onClick={() => setSelectedColor(c)}
                                className={`w-6 h-6 rounded-full border-2 transition-all ${selectedColor === c ? 'border-slate-900 dark:border-white scale-110' : 'border-transparent hover:scale-105'}`}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Groups Grid */}
            {groupsLoading ? (
                <div role="status" aria-label="Loading keyword groups" className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                </div>
            ) : groupError ? null : groups.length === 0 ? (
                <div className="glass-panel rounded-2xl text-center py-14 px-6">
                    <FolderOpen className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3 animate-float" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">No groups yet.</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Create groups to organize your keywords by category.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groups.map((group: KeywordGroup) => (
                        <div
                            key={group.id}
                            className="glass-panel rounded-xl p-4 hover:shadow-md transition-all duration-200 group/card"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{group.name}</h4>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button" disabled={saving} aria-label={`Assign keywords to ${group.name}`}
                                        onClick={() => { setAssigningGroup(assigningGroup === group.id ? null : group.id); setSelectedKeywordIds([]); }}
                                        className="p-1.5 text-slate-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
                                        title="Assign keywords"
                                    >
                                        <Tag className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        type="button" disabled={saving} aria-label={`Delete group ${group.name}`}
                                        onClick={() => {
                                            if (pending.current || !window.confirm(`Delete "${group.name}"?`)) return;
                                            void mutate(() => deleteGroup.mutateAsync(group.id), () => { if (assigningGroup === group.id) { setAssigningGroup(null); setSelectedKeywordIds([]); } });
                                        }}
                                        className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                                        title="Delete group"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Keywords</p>
                                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{group.keywordCount}</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Avg Pos</p>
                                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                        {group.avgPosition ? `#${Math.round(group.avgPosition)}` : '—'}
                                    </p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Clicks</p>
                                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{group.totalClicks ?? 'Unavailable'}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Keyword Assignment Panel */}
            {assigningGroup && (
                <div className="glass-panel rounded-xl p-4 space-y-3 animate-fade-slide-up">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Assign keywords to {groups.find((g: KeywordGroup) => g.id === assigningGroup)?.name}
                        </h4>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => handleAssign(assigningGroup)}
                                disabled={selectedKeywordIds.length === 0 || assignKeywords.isPending || saving || !!keywordError}
                                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                            >
                                {assignKeywords.isPending ? 'Saving...' : `Assign ${selectedKeywordIds.length} keywords`}
                            </button>
                            <button type="button" disabled={saving} aria-label="Cancel keyword assignment" onClick={() => { setAssigningGroup(null); setSelectedKeywordIds([]); }} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50">
                        {keywords.map((kw: TrackedKeywordSummary) => (
                            <label
                                key={kw.id}
                                className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors"
                            >
                                <input
                                    disabled={saving}
                                    type="checkbox"
                                    checked={selectedKeywordIds.includes(kw.id)}
                                    onChange={() => toggleKeyword(kw.id)}
                                    className="rounded border-slate-300 dark:border-slate-600 text-blue-600"
                                />
                                <span className="text-sm text-slate-700 dark:text-slate-300">{kw.keyword}</span>
                                {kw.groupName && (
                                    <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">{kw.groupName}</span>
                                )}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
