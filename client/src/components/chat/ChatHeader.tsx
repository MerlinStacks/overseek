/**
 * ChatHeader Component
 * Extracted from ChatWindow for better maintainability.
 * Displays conversation recipient info and action buttons.
 */

import { useState } from 'react';
import { ChevronDown, Clock, CheckCircle, RotateCcw, MoreHorizontal, MoreVertical, Search, Users, Merge, Ban, Eye } from 'lucide-react';
import { cn } from '../../utils/cn';
import { MacrosDropdown } from './MacrosDropdown';
import { RecipientList, MergedRecipient } from './RecipientList';

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
    onStatusChange: (status: string) => void;
    onShowSnooze: () => void;
    onShowAssign: () => void;
    onShowMerge: () => void;
    onBlock?: () => Promise<void>;
    /** Other users currently viewing this conversation */
    otherViewers?: Viewer[];
    /** Merged recipients from merged conversations */
    mergedRecipients?: MergedRecipient[];
    /** Primary channel of this conversation */
    primaryChannel?: string;
}

export function ChatHeader({
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

    const isOpen = status === 'OPEN';
    const hasOtherViewers = otherViewers.length > 0;

    return (
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
            {/* Left - Sender Info */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-medium">
                    {recipientName ? recipientName.charAt(0).toUpperCase() : 'C'}
                </div>
                <RecipientList
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
                        {otherViewers.slice(0, 3).map((viewer, i) => (
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
                <div className="relative">
                    <div className="flex">
                        <button
                            onClick={() => onStatusChange(isOpen ? 'CLOSED' : 'OPEN')}
                            disabled={isUpdatingStatus}
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
                        <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                            <button
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
                                onClick={() => {
                                    setShowActionsMenu(false);
                                    onStatusChange('PENDING');
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
                <div className="relative">
                    <button
                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                        aria-label="More options"
                        className="p-1.5 rounded-sm hover:bg-gray-100 text-gray-500"
                    >
                        <MoreVertical size={16} />
                    </button>

                    {/* More Options Dropdown */}
                    {showMoreMenu && (
                        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                            <button
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
                                    onClick={async () => {
                                        setShowMoreMenu(false);
                                        if (confirm(`Block ${recipientEmail}? Their future messages will be auto-resolved without notifications.`)) {
                                            await onBlock();
                                        }
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
        </div>
    );
}
