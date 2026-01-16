/**
 * BulkActionToolbar
 * 
 * Floating toolbar that appears when conversations are selected.
 * Provides bulk actions: Close, Assign, Add Label, Merge.
 */

import { useState } from 'react';
import { Logger } from '../../utils/logger';
import { X, CheckCircle, UserPlus, Tag, Loader2, XCircle, FolderOpen, Merge } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface BulkActionToolbarProps {
    selectedIds: string[];
    onClearSelection: () => void;
    onActionComplete: () => void;
    users?: { id: string; fullName: string }[];
    labels?: { id: string; name: string; color: string }[];
}

type BulkAction = 'close' | 'open' | 'assign' | 'addLabel';

export function BulkActionToolbar({
    selectedIds,
    onClearSelection,
    onActionComplete,
    users = [],
    labels = [],
}: BulkActionToolbarProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isLoading, setIsLoading] = useState(false);
    const [showAssignDropdown, setShowAssignDropdown] = useState(false);
    const [showLabelDropdown, setShowLabelDropdown] = useState(false);
    const [showMergeConfirm, setShowMergeConfirm] = useState(false);
    const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);

    const performBulkAction = async (
        action: BulkAction,
        options?: { labelId?: string; assignToUserId?: string }
    ) => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/chat/conversations/bulk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
                body: JSON.stringify({
                    conversationIds: selectedIds,
                    action,
                    ...options,
                }),
            });

            if (res.ok) {
                onActionComplete();
                onClearSelection();
            } else {
                const data = await res.json();
                Logger.error('Bulk action failed', { error: data.error });
            }
        } catch (error) {
            Logger.error('Bulk action error:', { error: error });
        } finally {
            setIsLoading(false);
            setShowAssignDropdown(false);
            setShowLabelDropdown(false);
        }
    };

    const performBulkMerge = async () => {
        if (!mergeTargetId) return;

        setIsLoading(true);
        try {
            const sourceIds = selectedIds.filter(id => id !== mergeTargetId);
            const res = await fetch('/api/chat/conversations/bulk-merge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
                body: JSON.stringify({
                    targetId: mergeTargetId,
                    sourceIds,
                }),
            });

            if (res.ok) {
                onActionComplete();
                onClearSelection();
            } else {
                const data = await res.json();
                Logger.error('Bulk merge failed', { error: data.error });
            }
        } catch (error) {
            Logger.error('Bulk merge error:', { error: error });
        } finally {
            setIsLoading(false);
            setShowMergeConfirm(false);
            setMergeTargetId(null);
        }
    };

    if (selectedIds.length === 0) return null;

    return (
        <>
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50">
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
                    {/* Selection Count */}
                    <div className="flex items-center gap-2 pr-3 border-r border-gray-700">
                        <span className="text-sm font-medium text-white">
                            {selectedIds.length} selected
                        </span>
                        <button
                            onClick={onClearSelection}
                            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
                            aria-label="Clear selection"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1">
                        {/* Close */}
                        <button
                            onClick={() => performBulkAction('close')}
                            disabled={isLoading}
                            className={cn(
                                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium',
                                'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors',
                                'disabled:opacity-50 disabled:cursor-not-allowed'
                            )}
                        >
                            {isLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <XCircle className="w-4 h-4" />
                            )}
                            Close
                        </button>

                        {/* Reopen */}
                        <button
                            onClick={() => performBulkAction('open')}
                            disabled={isLoading}
                            className={cn(
                                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium',
                                'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors',
                                'disabled:opacity-50 disabled:cursor-not-allowed'
                            )}
                        >
                            <FolderOpen className="w-4 h-4" />
                            Reopen
                        </button>

                        {/* Merge - only show when 2+ selected */}
                        {selectedIds.length >= 2 && (
                            <button
                                onClick={() => {
                                    setMergeTargetId(selectedIds[0]);
                                    setShowMergeConfirm(true);
                                }}
                                disabled={isLoading}
                                className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium',
                                    'bg-indigo-700 text-white hover:bg-indigo-600 transition-colors',
                                    'disabled:opacity-50 disabled:cursor-not-allowed'
                                )}
                            >
                                <Merge className="w-4 h-4" />
                                Merge
                            </button>
                        )}

                        {/* Assign */}
                        <div className="relative">
                            <button
                                onClick={() => {
                                    setShowAssignDropdown(!showAssignDropdown);
                                    setShowLabelDropdown(false);
                                }}
                                disabled={isLoading}
                                className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium',
                                    'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors',
                                    'disabled:opacity-50 disabled:cursor-not-allowed',
                                    showAssignDropdown && 'bg-gray-700 text-white'
                                )}
                            >
                                <UserPlus className="w-4 h-4" />
                                Assign
                            </button>

                            {/* Assign Dropdown */}
                            {showAssignDropdown && (
                                <div className="absolute bottom-full left-0 mb-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1">
                                    {users.length === 0 ? (
                                        <div className="px-3 py-2 text-sm text-gray-500">No users available</div>
                                    ) : (
                                        users.map((user) => (
                                            <button
                                                key={user.id}
                                                onClick={() => performBulkAction('assign', { assignToUserId: user.id })}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-200 hover:bg-gray-700 transition-colors"
                                            >
                                                <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-xs text-white">
                                                    {user.fullName?.charAt(0) || '?'}
                                                </div>
                                                {user.fullName || 'Unknown'}
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Add Label */}
                        <div className="relative">
                            <button
                                onClick={() => {
                                    setShowLabelDropdown(!showLabelDropdown);
                                    setShowAssignDropdown(false);
                                }}
                                disabled={isLoading}
                                className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium',
                                    'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors',
                                    'disabled:opacity-50 disabled:cursor-not-allowed',
                                    showLabelDropdown && 'bg-gray-700 text-white'
                                )}
                            >
                                <Tag className="w-4 h-4" />
                                Label
                            </button>

                            {/* Label Dropdown */}
                            {showLabelDropdown && (
                                <div className="absolute bottom-full left-0 mb-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1">
                                    {labels.length === 0 ? (
                                        <div className="px-3 py-2 text-sm text-gray-500">No labels created</div>
                                    ) : (
                                        labels.map((label) => (
                                            <button
                                                key={label.id}
                                                onClick={() => performBulkAction('addLabel', { labelId: label.id })}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-200 hover:bg-gray-700 transition-colors"
                                            >
                                                <span
                                                    className="w-3 h-3 rounded-full"
                                                    style={{ backgroundColor: label.color }}
                                                />
                                                {label.name}
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Merge Confirmation Modal */}
            {showMergeConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-indigo-100 rounded-lg">
                                <Merge className="w-5 h-5 text-indigo-600" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900">Merge Conversations</h3>
                        </div>

                        <p className="text-sm text-gray-600 mb-4">
                            Select the target conversation. All messages from the other {selectedIds.length - 1} conversation(s)
                            will be moved into the target.
                        </p>

                        <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg mb-4">
                            ⚠️ This action cannot be undone. The source conversations will be closed.
                        </p>

                        <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
                            {selectedIds.map((id, index) => (
                                <label
                                    key={id}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                                        mergeTargetId === id
                                            ? "border-indigo-500 bg-indigo-50"
                                            : "border-gray-200 hover:border-gray-300"
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="mergeTarget"
                                        checked={mergeTargetId === id}
                                        onChange={() => setMergeTargetId(id)}
                                        className="text-indigo-600"
                                    />
                                    <span className="text-sm text-gray-700">
                                        Conversation #{index + 1}
                                        {mergeTargetId === id && (
                                            <span className="ml-2 text-xs text-indigo-600 font-medium">(Target)</span>
                                        )}
                                    </span>
                                </label>
                            ))}
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowMergeConfirm(false);
                                    setMergeTargetId(null);
                                }}
                                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={performBulkMerge}
                                disabled={!mergeTargetId || isLoading}
                                className={cn(
                                    "flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors",
                                    "bg-indigo-600 hover:bg-indigo-700",
                                    "disabled:opacity-50 disabled:cursor-not-allowed"
                                )}
                            >
                                {isLoading ? 'Merging...' : 'Merge Conversations'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
