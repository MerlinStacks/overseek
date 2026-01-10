
import { formatDistanceToNow } from 'date-fns';
import { Mail, User, MessageSquare, Filter, ChevronDown, Pencil, Eye, EyeOff, Plus } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useState } from 'react';
import { useDrafts } from '../../hooks/useDrafts';

interface Conversation {
    id: string;
    wooCustomerId?: string;
    wooCustomer?: {
        firstName?: string;
        lastName?: string;
        email?: string;
    };
    guestEmail?: string;
    guestName?: string;
    assignedTo?: string;
    assignee?: {
        id: string;
        fullName?: string;
    };
    messages: { content: string, createdAt: string, senderType: string }[];
    updatedAt: string;
    status: string;
    isRead?: boolean;
}

interface ConversationListProps {
    conversations: Conversation[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    currentUserId?: string;
    onCompose?: () => void;
}

type FilterType = 'all' | 'mine' | 'unassigned';

export function ConversationList({ conversations, selectedId, onSelect, currentUserId, onCompose }: ConversationListProps) {
    const [filter, setFilter] = useState<FilterType>('all');
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [showResolved, setShowResolved] = useState(false);
    const { hasDraft } = useDrafts();

    // Filter conversations - by default only show OPEN unless showResolved is true
    const filteredConversations = conversations.filter(conv => {
        // Status filter: only show OPEN by default
        if (!showResolved && conv.status !== 'OPEN') return false;

        // Assignment filter
        if (filter === 'mine') return conv.assignedTo === currentUserId;
        if (filter === 'unassigned') return !conv.assignedTo;
        return true;
    });

    // Count by filter (only count OPEN conversations unless showResolved)
    const getFilteredCount = (filterFn: (c: Conversation) => boolean) => {
        return conversations.filter(c => {
            if (!showResolved && c.status !== 'OPEN') return false;
            return filterFn(c);
        }).length;
    };

    const counts = {
        all: getFilteredCount(() => true),
        mine: getFilteredCount(c => c.assignedTo === currentUserId),
        unassigned: getFilteredCount(c => !c.assignedTo)
    };

    const getDisplayName = (conv: Conversation) => {
        if (conv.wooCustomer) {
            const name = `${conv.wooCustomer.firstName || ''} ${conv.wooCustomer.lastName || ''}`.trim();
            return name || conv.wooCustomer.email || 'Customer';
        }
        return conv.guestName || conv.guestEmail || 'Visitor';
    };

    const getInitials = (name: string) => {
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
    };

    const getPreview = (conv: Conversation) => {
        const lastMsg = conv.messages[0];
        if (!lastMsg) return { subject: null, preview: 'No messages' };

        let content = lastMsg.content;
        let subject: string | null = null;

        // Extract subject if present
        if (content.startsWith('Subject:')) {
            const lines = content.split('\n');
            subject = lines[0].replace('Subject:', '').trim();
            content = lines.length > 2 ? lines.slice(2).join(' ') : '';
        }

        // Strip HTML tags for preview
        const preview = content.replace(/<[^>]*>/g, '').trim().slice(0, 80);
        return { subject, preview };
    };

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-200 w-80">
            {/* Header with Filters */}
            <div className="p-3 border-b border-gray-100">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-800 text-lg">Conversations</h2>
                    <div className="flex items-center gap-1">
                        {onCompose && (
                            <button
                                onClick={onCompose}
                                className="p-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                title="Compose new email"
                            >
                                <Plus size={16} />
                            </button>
                        )}
                        <div className="relative">
                            <button
                                onClick={() => setShowFilterMenu(!showFilterMenu)}
                                className="p-1.5 rounded-sm hover:bg-gray-100 text-gray-500"
                            >
                                <Filter size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                    <button
                        onClick={() => setFilter('mine')}
                        className={cn(
                            "flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors",
                            filter === 'mine' ? "bg-white text-blue-600 shadow-xs" : "text-gray-600 hover:text-gray-900"
                        )}
                    >
                        Mine {counts.mine > 0 && <span className="ml-1 text-gray-400">{counts.mine}</span>}
                    </button>
                    <button
                        onClick={() => setFilter('unassigned')}
                        className={cn(
                            "flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors",
                            filter === 'unassigned' ? "bg-white text-blue-600 shadow-xs" : "text-gray-600 hover:text-gray-900"
                        )}
                    >
                        Unassigned {counts.unassigned > 0 && <span className="ml-1 text-gray-400">{counts.unassigned}</span>}
                    </button>
                    <button
                        onClick={() => setFilter('all')}
                        className={cn(
                            "flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors",
                            filter === 'all' ? "bg-white text-blue-600 shadow-xs" : "text-gray-600 hover:text-gray-900"
                        )}
                    >
                        All {counts.all > 0 && <span className="ml-1 text-gray-400">{counts.all}</span>}
                    </button>
                </div>

                {/* Show Resolved Toggle */}
                <button
                    onClick={() => setShowResolved(!showResolved)}
                    className={cn(
                        "flex items-center justify-center gap-1.5 w-full mt-2 py-1.5 text-xs rounded-md transition-colors",
                        showResolved
                            ? "bg-gray-200 text-gray-700"
                            : "text-gray-500 hover:bg-gray-100"
                    )}
                >
                    {showResolved ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showResolved ? 'Hide Resolved' : 'Show Resolved'}
                </button>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto">
                {filteredConversations.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm">
                        No conversations found
                    </div>
                ) : (
                    filteredConversations.map(conv => {
                        const name = getDisplayName(conv);
                        const { subject, preview } = getPreview(conv);
                        const initials = getInitials(name);
                        const isSelected = selectedId === conv.id;
                        const isEmail = conv.guestEmail || conv.wooCustomer?.email;
                        const conversationHasDraft = hasDraft(conv.id);
                        const isUnread = conv.isRead === false;

                        return (
                            <div
                                key={conv.id}
                                onClick={() => onSelect(conv.id)}
                                className={cn(
                                    "flex gap-3 p-3 cursor-pointer border-b border-gray-100 transition-colors",
                                    isSelected
                                        ? "bg-blue-50 border-l-2 border-l-blue-600"
                                        : "hover:bg-gray-50 border-l-2 border-l-transparent",
                                    isUnread && !isSelected && "bg-blue-50/50"
                                )}
                            >
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
                                            )}>{name}</span>
                                        </div>
                                        <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                                            {formatDistanceToNow(new Date(conv.updatedAt), { addSuffix: false })}
                                        </span>
                                    </div>

                                    {/* Subject line (prominent like email clients) */}
                                    {subject && (
                                        <p className={cn(
                                            "text-sm truncate mt-0.5",
                                            isUnread ? "font-semibold text-gray-900" : "font-medium text-gray-800"
                                        )}>
                                            {subject}
                                        </p>
                                    )}

                                    {/* Body preview */}
                                    <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">
                                        {preview || (subject ? '' : 'No content')}
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
                                        {conversationHasDraft && (
                                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded-sm">
                                                <Pencil size={10} />
                                                Draft
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
