
import { formatDistanceToNow } from 'date-fns';
import { Virtuoso } from 'react-virtuoso';
import { Logger } from '../../utils/logger';
import { Mail, Filter, ChevronDown, Pencil, Eye, EyeOff, Plus, Search, X, Loader2, Tag, Square, CheckSquare } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useDrafts } from '../../hooks/useDrafts';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { BulkActionToolbar } from './BulkActionToolbar';

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
    labels?: { id: string; name: string; color: string }[];
}

interface Label {
    id: string;
    name: string;
    color: string;
    _count?: { conversations: number };
}

interface ConversationListProps {
    conversations: Conversation[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onPreload?: (id: string) => void;
    currentUserId?: string;
    onCompose?: () => void;
    onRefresh?: () => void;
    users?: { id: string; fullName: string }[];
}

type FilterType = 'all' | 'mine' | 'unassigned';

export function ConversationList({ conversations, selectedId, onSelect, onPreload, currentUserId, onCompose, onRefresh, users = [] }: ConversationListProps) {
    const [filter, setFilter] = useState<FilterType>('all');
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [showResolved, setShowResolved] = useState(false);
    const { hasDraft } = useDrafts();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Bulk Selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    // Label filter
    const [allLabels, setAllLabels] = useState<Label[]>([]);
    const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
    const [showLabelFilter, setShowLabelFilter] = useState(false);

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Conversation[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const isSearchMode = searchQuery.trim().length >= 2;

    // Fetch available labels
    useEffect(() => {
        if (!token || !currentAccount) return;
        fetch('/api/labels', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount.id
            }
        })
            .then(res => res.json())
            .then(data => setAllLabels(data.labels || []))
            .catch(e => Logger.error('Failed to fetch labels', { error: e }));
    }, [token, currentAccount]);

    // Clear selection when conversations change
    useEffect(() => {
        setSelectedIds(new Set());
        setIsSelectionMode(false);
    }, [conversations]);

    const toggleSelection = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
        setIsSelectionMode(newSelected.size > 0);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredConversations.length) {
            setSelectedIds(new Set());
            setIsSelectionMode(false);
        } else {
            setSelectedIds(new Set(filteredConversations.map(c => c.id)));
            setIsSelectionMode(true);
        }
    };

    // Debounced search
    useEffect(() => {
        if (!isSearchMode || !token || !currentAccount) {
            setSearchResults([]);
            return;
        }

        const timeout = setTimeout(async () => {
            setIsSearching(true);
            try {
                const res = await fetch(`/api/chat/conversations/search?q=${encodeURIComponent(searchQuery)}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setSearchResults(data.results || []);
                }
            } catch (e) {
                Logger.error('Search failed', { error: e });
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => clearTimeout(timeout);
    }, [searchQuery, token, currentAccount, isSearchMode]);

    // Memoized: Use search results when searching, otherwise normal filtered list
    const filteredConversations = useMemo(() => {
        if (isSearchMode) return searchResults;

        return conversations.filter(conv => {
            // Status filter: only show OPEN by default
            if (!showResolved && conv.status !== 'OPEN') return false;

            // Label filter
            if (selectedLabelId) {
                if (!conv.labels?.some(l => l.id === selectedLabelId)) return false;
            }

            // Assignment filter
            if (filter === 'mine') return conv.assignedTo === currentUserId;
            if (filter === 'unassigned') return !conv.assignedTo;
            return true;
        });
    }, [isSearchMode, searchResults, conversations, showResolved, selectedLabelId, filter, currentUserId]);

    // Memoized counts - only recalculates when conversations or filters change
    const counts = useMemo(() => {
        const getFilteredCount = (filterFn: (c: Conversation) => boolean) => {
            return conversations.filter(c => {
                if (!showResolved && c.status !== 'OPEN') return false;
                return filterFn(c);
            }).length;
        };

        return {
            all: getFilteredCount(() => true),
            mine: getFilteredCount(c => c.assignedTo === currentUserId),
            unassigned: getFilteredCount(c => !c.assignedTo)
        };
    }, [conversations, showResolved, currentUserId]);

    const getDisplayName = useCallback((conv: Conversation) => {
        if (conv.wooCustomer) {
            const name = `${conv.wooCustomer.firstName || ''} ${conv.wooCustomer.lastName || ''}`.trim();
            return name || conv.wooCustomer.email || 'Customer';
        }
        return conv.guestName || conv.guestEmail || 'Visitor';
    }, []);

    const getInitials = useCallback((name: string) => {
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
    }, []);

    /**
     * Gets the timestamp of the last CUSTOMER message for display.
     * Falls back to last message or updatedAt if no customer message found.
     */
    const getLastCustomerMessageTime = useCallback((conv: Conversation): string => {
        const lastCustomerMsg = conv.messages.find(m => m.senderType === 'CUSTOMER');
        return lastCustomerMsg?.createdAt || conv.messages[0]?.createdAt || conv.updatedAt;
    }, []);

    const getPreview = useCallback((conv: Conversation) => {
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
    }, []);

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-200 w-80">
            {/* Header with Filters */}
            <div className="p-3 border-b border-gray-100">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-800 text-lg">Conversations</h2>
                    <div className="flex items-center gap-1">{onCompose && (
                        <button
                            onClick={onCompose}
                            className="p-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                            title="Compose new email"
                        >
                            <Plus size={16} />
                        </button>
                    )}
                        {/* Label Filter */}
                        <div className="relative">
                            <button
                                onClick={() => setShowLabelFilter(!showLabelFilter)}
                                className={cn(
                                    "p-1.5 rounded-sm hover:bg-gray-100",
                                    selectedLabelId ? "text-indigo-600 bg-indigo-50" : "text-gray-500"
                                )}
                                title="Filter by label"
                            >
                                <Tag size={16} />
                            </button>
                            {showLabelFilter && (
                                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-xl z-20 py-1">
                                    <button
                                        onClick={() => { setSelectedLabelId(null); setShowLabelFilter(false); }}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50",
                                            !selectedLabelId && "bg-gray-50 font-medium"
                                        )}
                                    >
                                        All Labels
                                    </button>
                                    {allLabels.map(label => (
                                        <button
                                            key={label.id}
                                            onClick={() => { setSelectedLabelId(label.id); setShowLabelFilter(false); }}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50",
                                                selectedLabelId === label.id && "bg-gray-50 font-medium"
                                            )}
                                        >
                                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: label.color }} />
                                            {label.name}
                                            {label._count?.conversations != null && (
                                                <span className="ml-auto text-xs text-gray-400">{label._count.conversations}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
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

                {/* Search Input */}
                <div className="relative mb-3">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search conversations..."
                        className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {isSearching && (
                        <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                    )}
                    {searchQuery && !isSearching && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Search mode indicator */}
                {isSearchMode && (
                    <div className="mb-2 text-xs text-gray-500 flex items-center gap-1">
                        <Search size={12} />
                        {isSearching ? 'Searching...' : `${filteredConversations.length} results for "${searchQuery}"`}
                    </div>
                )}

                {/* Filter Tabs - hide when searching */}
                {!isSearchMode && (
                    <>
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
                    </>
                )}
            </div>

            {/* Conversations List - Virtualized for performance */}
            <div className="flex-1 overflow-hidden">
                {filteredConversations.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm">
                        No conversations found
                    </div>
                ) : (
                    <Virtuoso
                        style={{ height: '100%' }}
                        data={filteredConversations}
                        overscan={5}
                        itemContent={(index, conv) => {
                            const name = getDisplayName(conv);
                            const { subject, preview } = getPreview(conv);
                            const initials = getInitials(name);
                            const isSelected = selectedId === conv.id;
                            const isEmail = conv.guestEmail || conv.wooCustomer?.email;
                            const conversationHasDraft = hasDraft(conv.id);
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
                                        selectedIds.has(conv.id) && "bg-indigo-50"
                                    )}
                                >
                                    {/* Checkbox for bulk selection */}
                                    <button
                                        onClick={(e) => toggleSelection(conv.id, e)}
                                        className="p-0.5 rounded hover:bg-gray-200 transition-colors shrink-0 self-start mt-2"
                                    >
                                        {selectedIds.has(conv.id) ? (
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
                                                )}>{name}</span>
                                            </div>
                                            <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                                                {formatDistanceToNow(new Date(getLastCustomerMessageTime(conv)), { addSuffix: false })}
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
                                            {/* Labels */}
                                            {conv.labels && conv.labels.slice(0, 2).map(label => (
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
                        }}
                    />
                )}
            </div>

            {/* Bulk Action Toolbar */}
            <BulkActionToolbar
                selectedIds={Array.from(selectedIds)}
                onClearSelection={() => {
                    setSelectedIds(new Set());
                    setIsSelectionMode(false);
                }}
                onActionComplete={() => {
                    onRefresh?.();
                }}
                users={users}
                labels={allLabels}
            />
        </div >
    );
}
