/**
 * ConversationItem — Renders a single conversation row in the sidebar list.
 * Extracted from ConversationList to keep files under the 200-line limit.
 */
import { memo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Mail, Pencil, Square, CheckSquare, Paperclip } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface Conversation {
    id: string;
    wooCustomerId?: string;
    wooCustomer?: {
        firstName?: string;
        lastName?: string;
        email?: string;
    };
    guestEmail?: string;
    guestName?: string;
    title?: string;
    assignedTo?: string;
    assignee?: {
        id: string;
        fullName?: string;
    };
    messages: { content: string, createdAt: string, senderType: string }[];
    updatedAt: string;
    status: string;
    isRead?: boolean;
    labels?: { id: string; name: string; color: string }[];
}

interface ConversationItemProps {
    conv: Conversation;
    isSelected: boolean;
    isSelectionMode: boolean;
    isBulkSelected: boolean;
    hasDraft: boolean;
    onSelect: (id: string) => void;
    onPreload?: (id: string) => void;
    onToggleSelection: (id: string, e: React.MouseEvent) => void;
    /** Preview data extracted by parent to avoid per-item recalculation */
    displayName: string;
    initials: string;
    subject: string | null;
    preview: string;
    showPaperclip: boolean;
    lastCustomerTime: string;
}

/** Renders a single conversation row with avatar, preview, badges. */
export const ConversationItem = memo(function ConversationItem({
    conv,
    isSelected,
    isSelectionMode,
    isBulkSelected,
    hasDraft,
    onSelect,
    onPreload,
    onToggleSelection,
    displayName,
    initials,
    subject,
    preview,
    showPaperclip,
    lastCustomerTime,
}: ConversationItemProps) {
    const isEmail = conv.guestEmail || conv.wooCustomer?.email;
    const isUnread = conv.isRead === false;

    return (
        <div
            onClick={() => !isSelectionMode && onSelect(conv.id)}
            onMouseEnter={() => onPreload?.(conv.id)}
            className={cn(
                "flex gap-3 p-3 cursor-pointer border-b border-gray-100 transition-colors",
                isSelected
                    ? "bg-blue-50 border-l-2 border-l-blue-600"
                    : "hover:bg-gray-50 border-l-2 border-l-transparent",
                isUnread && !isSelected && "bg-blue-50/50",
                isBulkSelected && "bg-indigo-50"
            )}
        >
            {/* Checkbox for bulk selection */}
            <button
                onClick={(e) => onToggleSelection(conv.id, e)}
                className="p-0.5 rounded hover:bg-gray-200 transition-colors shrink-0 self-start mt-2"
            >
                {isBulkSelected ? (
                    <CheckSquare size={16} className="text-indigo-600" />
                ) : (
                    <Square size={16} className="text-gray-400" />
                )}
            </button>
            {/* Avatar */}
            <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0",
                isSelected ? "bg-blue-600" : "bg-gray-500"
            )}>
                {initials}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                {/* Sender row */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                        {isUnread && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full shrink-0" />
                        )}
                        {isEmail && <Mail size={12} className="text-gray-400 shrink-0" />}
                        <span className={cn(
                            "truncate text-sm",
                            isUnread ? "font-bold text-gray-900" : "font-medium text-gray-700"
                        )}>{displayName}</span>
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                        {formatDistanceToNow(new Date(lastCustomerTime), { addSuffix: false })}
                    </span>
                </div>

                {/* Subject line */}
                {subject && (
                    <p className={cn(
                        "text-sm truncate mt-0.5",
                        isUnread ? "font-semibold text-gray-900" : "font-medium text-gray-800"
                    )}>
                        {subject}
                    </p>
                )}

                {/* Body preview */}
                <p className="text-xs text-gray-500 line-clamp-1 mt-0.5 flex items-center gap-1">
                    {showPaperclip && <Paperclip size={10} className="text-gray-400 shrink-0" />}
                    <span>{preview || (subject ? '' : 'No content')}</span>
                </p>

                {/* Status Badge */}
                <div className="flex items-center gap-2 mt-1.5">
                    {conv.status === 'OPEN' && (
                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-medium rounded-sm">
                            Open
                        </span>
                    )}
                    {conv.assignee && (
                        <span className="text-[10px] text-gray-400">
                            → {conv.assignee.fullName || 'Assigned'}
                        </span>
                    )}
                    {hasDraft && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded-sm">
                            <Pencil size={10} />
                            Draft
                        </span>
                    )}
                    {/* Labels */}
                    {conv.labels && conv.labels.slice(0, 2).map((label) => (
                        <span
                            key={label.id}
                            className="px-1.5 py-0.5 text-[10px] font-medium rounded-sm"
                            style={{
                                backgroundColor: `${label.color}20`,
                                color: label.color,
                            }}
                        >
                            {label.name}
                        </span>
                    ))}
                    {conv.labels && conv.labels.length > 2 && (
                        <span className="text-[10px] text-gray-400">+{conv.labels.length - 2}</span>
                    )}
                </div>
            </div>
        </div>
    );
});
