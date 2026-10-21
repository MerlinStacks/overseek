/**
 * ChatHeader Component
 * Extracted from ChatWindow for better maintainability.
 * Displays conversation recipient info and action buttons.
 */

import { useState, useEffect, useCallback, useId } from 'react';
import { ChevronDown, Clock, CheckCircle, RotateCcw, MoreHorizontal, MoreVertical, Search, Users, Merge, Ban, Eye } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useClickOutside } from '../../hooks/useClickOutside';
import { MacrosDropdown } from './MacrosDropdown';
import { RecipientList, MergedRecipient } from './RecipientList';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { Modal } from '../ui/Modal';

interface Viewer {
    userId: string;
    name: string;
    avatarUrl?: string;
}

interface ChatHeaderProps {
    conversationId: string;
    recipientName?: string;
    recipientEmail?: string;
    status?: string;
    isUpdatingStatus: boolean;
    showSearch: boolean;
    onToggleSearch: () => void;
    onStatusChange: (status: string) => void | Promise<void>;
    onShowSnooze: () => void;
    onShowAssign: () => void;
    onShowMerge: () => void;
    onBlock?: (signal?: AbortSignal) => Promise<void>;
    /** Other users currently viewing this conversation */
    otherViewers?: Viewer[];
    /** Merged recipients from merged conversations */
    mergedRecipients?: MergedRecipient[];
    /** Primary channel of this conversation */
    primaryChannel?: string;
}

export function ChatHeader(props: ChatHeaderProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    return <ScopedChatHeader key={JSON.stringify([props.conversationId, props.recipientEmail, props.primaryChannel, currentAccount?.id, token])} {...props} />;
}
function ScopedChatHeader({
    conversationId,
    recipientName,
    recipientEmail,
    status,
    isUpdatingStatus,
    showSearch,
    onToggleSearch,
    onStatusChange,
    onShowSnooze,
    onShowAssign,
    onShowMerge,
    onBlock,
    otherViewers = [],
    mergedRecipients = [],
    primaryChannel = 'EMAIL'
}: ChatHeaderProps) {
    const [showActionsMenu, setShowActionsMenu] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showBlockConfirm, setShowBlockConfirm] = useState(false);
    const mutation = useScopedMutation(); const statusMenuId = useId(); const moreMenuId = useId();
    const locked = isUpdatingStatus || mutation.busy;
    const changeStatus = async (nextStatus: string) => {
        if (isUpdatingStatus || mutation.isPending()) return;
        setShowActionsMenu(false);
        await mutation.run(() => Promise.resolve(onStatusChange(nextStatus)), 'Could not confirm status change. Check the conversation before retrying.');
    };
    const block = async () => {
        if (isUpdatingStatus || mutation.isPending() || !onBlock || !recipientEmail) return;
        const result = await mutation.run(signal => onBlock(signal), 'Could not confirm blocking. Check customer status before retrying.');
        if (result.ok) setShowBlockConfirm(false);
    };

    // Close dropdowns on outside click
    const actionsMenuRef = useClickOutside<HTMLDivElement>(
        useCallback(() => setShowActionsMenu(false), [setShowActionsMenu]),
        showActionsMenu
    );
    const moreMenuRef = useClickOutside<HTMLDivElement>(
        useCallback(() => setShowMoreMenu(false), [setShowMoreMenu]),
        showMoreMenu
    );

    // Close block-confirm modal on Escape key
    useEffect(() => {
        if (!showActionsMenu && !showMoreMenu) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setShowActionsMenu(false); setShowMoreMenu(false); }
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [showActionsMenu, showMoreMenu]);

    const isOpen = status === 'OPEN';
    const hasOtherViewers = otherViewers.length > 0;

    return (
        <div className="flex flex-wrap gap-3 items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
            {mutation.error && !showBlockConfirm && <p role="alert">{mutation.error}</p>}
            {/* Left - Sender Info */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-medium">
                    {recipientName ? recipientName.charAt(0).toUpperCase() : 'C'}
                </div>
                <RecipientList
                    scopeKey={conversationId}
                    primaryEmail={recipientEmail}
                    primaryName={recipientName}
                    primaryChannel={primaryChannel}
                    mergedRecipients={mergedRecipients}
                />
            </div>

            {/* Center - Other Viewers Indicator */}
            {hasOtherViewers && (
                <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full">
                    <Eye size={14} className="text-amber-600" />
                    <div className="flex -space-x-2">
                        {otherViewers.slice(0, 3).map((viewer) => (
                            <div
                                key={viewer.userId}
                                className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-white text-[10px] font-medium border-2 border-white"
                                title={viewer.name}
                            >
                                {viewer.avatarUrl ? (
                                    <img src={viewer.avatarUrl} alt={viewer.name} className="w-full h-full rounded-full object-cover" />
                                ) : (
                                    viewer.name.charAt(0).toUpperCase()
                                )}
                            </div>
                        ))}
                    </div>
                    <span className="text-xs font-medium text-amber-700">
                        {otherViewers.length === 1
                            ? `${otherViewers[0].name} is viewing`
                            : `${otherViewers.length} others viewing`
                        }
                    </span>
                </div>
            )}

            {/* Right - Actions */}
            <div className="flex items-center gap-2">
                {/* Macros Quick Actions */}
                <MacrosDropdown conversationId={conversationId} />

                {/* Resolve/Reopen Button with Dropdown */}
                <div className="relative" ref={actionsMenuRef}>
                    <div className="flex">
                        <button
                            type="button"
                            onClick={() => void changeStatus(isOpen ? 'CLOSED' : 'OPEN')}
                            disabled={locked || !status}
                            aria-label={isOpen ? 'Resolve conversation' : 'Reopen conversation'}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-sm font-medium transition-colors",
                                isOpen
                                    ? "bg-green-600 text-white hover:bg-green-700"
                                    : "bg-blue-600 text-white hover:bg-blue-700",
                                isUpdatingStatus && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            {isOpen ? <CheckCircle size={14} /> : <RotateCcw size={14} />}
                            {isUpdatingStatus ? '...' : (isOpen ? 'Resolve' : 'Reopen')}
                        </button>
                        <button
                            type="button" disabled={locked} aria-expanded={showActionsMenu} aria-controls={statusMenuId}
                            onClick={() => setShowActionsMenu(!showActionsMenu)}
                            aria-label="More status options"
                            className={cn(
                                "px-2 py-1.5 rounded-r-lg border-l transition-colors",
                                isOpen
                                    ? "bg-green-600 text-white hover:bg-green-700 border-green-700"
                                    : "bg-blue-600 text-white hover:bg-blue-700 border-blue-700"
                            )}
                        >
                            <ChevronDown size={14} />
                        </button>
                    </div>

                    {/* Dropdown Menu */}
                    {showActionsMenu && (
                        <div id={statusMenuId} role="group" aria-label="Status options" className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-20">
                            <button
                                type="button" disabled={locked}
                                onClick={() => {
                                    setShowActionsMenu(false);
                                    onShowSnooze();
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                <Clock size={14} />
                                Snooze
                            </button>
                            <button
                                type="button" disabled={locked}
                                onClick={() => {
                                    setShowActionsMenu(false);
                                    void changeStatus('PENDING');
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                <MoreHorizontal size={14} />
                                Mark as pending
                            </button>
                        </div>
                    )}
                </div>

                {/* Search Button */}
                <button
                    type="button" aria-pressed={showSearch}
                    onClick={onToggleSearch}
                    aria-label="Search messages"
                    className={cn(
                        "p-1.5 rounded-sm transition-colors",
                        showSearch ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100 text-gray-500"
                    )}
                    title="Search messages"
                >
                    <Search size={16} />
                </button>

                {/* More Options */}
                <div className="relative" ref={moreMenuRef}>
                    <button
                        type="button" disabled={locked} aria-expanded={showMoreMenu} aria-controls={moreMenuId}
                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                        aria-label="More options"
                        className="p-1.5 rounded-sm hover:bg-gray-100 text-gray-500"
                    >
                        <MoreVertical size={16} />
                    </button>

                    {/* More Options Dropdown */}
                    {showMoreMenu && (
                        <div id={moreMenuId} role="group" aria-label="Conversation options" className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-20">
                            <button
                                type="button" disabled={locked}
                                onClick={() => {
                                    setShowMoreMenu(false);
                                    onShowAssign();
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors rounded-t-lg"
                            >
                                <Users size={14} />
                                Assign to team member
                            </button>
                            <button
                                type="button" disabled={locked}
                                onClick={() => {
                                    setShowMoreMenu(false);
                                    onShowMerge();
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                <Merge size={14} />
                                Merge with another conversation
                            </button>
                            {recipientEmail && onBlock && (
                                <button
                                    type="button" disabled={locked}
                                    onClick={() => {
                                        setShowMoreMenu(false);
                                        setShowBlockConfirm(true);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors rounded-b-lg border-t border-gray-100"
                                >
                                    <Ban size={14} />
                                    Block customer
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {/* Block Customer Confirmation Modal */}
            <Modal isOpen={showBlockConfirm} onClose={mutation.busy ? undefined : () => setShowBlockConfirm(false)} title="Block Customer">
                <p>Block <strong>{recipientEmail}</strong>? Their future messages will be auto-resolved without notifications.</p>
                {mutation.error && <p role="alert">{mutation.error}</p>}{mutation.busy && <p role="status">Blocking customer...</p>}
                <div className="flex justify-end gap-3 mt-4"><button type="button" disabled={mutation.busy} onClick={() => setShowBlockConfirm(false)}>Cancel</button><button type="button" disabled={locked} onClick={() => void block()}>{mutation.busy ? 'Blocking...' : 'Block'}</button></div>
            </Modal>
        </div>
    );
}
