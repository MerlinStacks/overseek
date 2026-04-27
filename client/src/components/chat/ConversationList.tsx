
import { Virtuoso } from 'react-virtuoso';
import { Logger } from '../../utils/logger';
import { Filter, Eye, EyeOff, Plus, Search, X, Loader2, Tag } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDrafts } from '../../hooks/useDrafts';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useClickOutside } from '../../hooks/useClickOutside';
import { BulkActionToolbar } from './BulkActionToolbar';
import { ConversationItem, type Conversation } from './ConversationItem';


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
    // Pagination props
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void;
    filter?: FilterType;
    onFilterChange?: (filter: FilterType) => void;
    showResolved?: boolean;
    onShowResolvedChange?: (show: boolean) => void;
}

type FilterType = 'all' | 'mine' | 'unassigned';

export function ConversationList({
    conversations,
    selectedId,
    onSelect,
    onPreload,
    currentUserId,
    onCompose,
    onRefresh,
    users = [],
    hasMore = false,
    isLoadingMore = false,
    onLoadMore,
    filter = 'all',
    onFilterChange,
    showResolved = false,
    onShowResolvedChange
}: ConversationListProps) {
    const [showFilterMenu, setShowFilterMenu] = useState(false);
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

    // Close dropdowns on outside click
    const labelFilterRef = useClickOutside<HTMLDivElement>(
        useCallback(() => setShowLabelFilter(false), []),
        showLabelFilter
    );
    const filterMenuRef = useClickOutside<HTMLDivElement>(
        useCallback(() => setShowFilterMenu(false), []),
        showFilterMenu
    );

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Conversation[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const isSearchMode = searchQuery.trim().length >= 2;
    const activeSearchController = useRef<AbortController | null>(null);
    const searchRequestIdRef = useRef(0);

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
            .then((data: unknown) => setAllLabels((data as { labels?: Label[] }).labels || []))
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

    // Debounced search
    useEffect(() => {
        if (!isSearchMode || !token || !currentAccount) {
            setSearchResults([]);
            return;
        }

        const timeout = setTimeout(async () => {
            setIsSearching(true);
            const requestId = ++searchRequestIdRef.current;
            activeSearchController.current?.abort();
            const controller = new AbortController();
            activeSearchController.current = controller;
            try {
                const res = await fetch(`/api/chat/conversations/search?q=${encodeURIComponent(searchQuery)}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    },
                    signal: controller.signal
                });
                if (res.ok) {
                    const data: unknown = await res.json();
                    // Only apply newest in-flight result to avoid stale overwrite.
                    if (requestId === searchRequestIdRef.current) {
                        setSearchResults((data as { results?: Conversation[] }).results || []);
                    }
                }
            } catch (e: unknown) {
                if (e instanceof DOMException && e.name === 'AbortError') return;
                Logger.error('Search failed', { error: e });
            } finally {
                if (requestId === searchRequestIdRef.current) {
                    setIsSearching(false);
                }
            }
        }, 300);

        return () => {
            clearTimeout(timeout);
            activeSearchController.current?.abort();
        };
    }, [searchQuery, token, currentAccount, isSearchMode]);

    // Memoized: Use search results when searching, otherwise normal filtered list
    const filteredConversations = useMemo(() => {
        if (isSearchMode) return searchResults;

        return conversations.filter(conv => {
            // Label filter
            if (selectedLabelId) {
                if (!conv.labels?.some(l => l.id === selectedLabelId)) return false;
            }
            return true;
        });
    }, [isSearchMode, searchResults, conversations, selectedLabelId]);

    // Precompute which conversations have drafts — avoids per-item localStorage reads
    const draftIds = useMemo(() => {
        const ids = new Set<string>();
        for (const c of filteredConversations) {
            if (hasDraft(c.id)) ids.add(c.id);
        }
        return ids;
    }, [filteredConversations, hasDraft]);

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
        // For guests: prefer name, fall back to email address, last resort is generic text
        return conv.guestName || conv.guestEmail || 'Unknown Contact';
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

    /** Detects whether message content contains attachment links. */
    const hasAttachments = useCallback((content: string): boolean => {
        return /\[Attachment:/.test(content) || /\[[^\]]+\]\(\/uploads\/attachments\//.test(content);
    }, []);

    const getPreview = useCallback((conv: Conversation) => {
        const lastMsg = conv.messages[0];
        if (!lastMsg) return { subject: conv.title || null, preview: 'No messages', showPaperclip: false };

        let content = lastMsg.content;
        const showPaperclip = hasAttachments(content);
        // Use stored conversation title if available, otherwise extract from message
        let subject: string | null = conv.title || null;

        // Extract subject from message content if not using stored title
        if (!subject && content.startsWith('Subject:')) {
            const lines = content.split('\n');
            subject = lines[0].replace('Subject:', '').trim();
            content = lines.length > 2 ? lines.slice(2).join(' ') : '';
        } else if (content.startsWith('Subject:')) {
            // Still strip Subject: prefix from content for preview
            const lines = content.split('\n');
            content = lines.length > 2 ? lines.slice(2).join(' ') : '';
        }

        // Strip attachment markdown links and headers before preview
        content = content.replace(/\[Attachment:\s*[^\]]*\]\([^)]*\)/gi, '');
        content = content.replace(/\[[^\]]+\]\(\/uploads\/[^)]+\)/gi, '');
        content = content.replace(/\*\*Attachments:\*\*\s*/gi, '');

        // Strip HTML tags, then decode common entities
        const preview = content
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
        return { subject, preview, showPaperclip };
    }, [hasAttachments]);

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
                        <div className="relative" ref={labelFilterRef}>
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
                        <div className="relative" ref={filterMenuRef}>
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
                        placeholder="Search, attachment:invoice, file:pdf..."
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
                                onClick={() => onFilterChange?.('mine')}
                                className={cn(
                                    "flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors",
                                    filter === 'mine' ? "bg-white text-blue-600 shadow-xs" : "text-gray-600 hover:text-gray-900"
                                )}
                            >
                                Mine {counts.mine > 0 && <span className="ml-1 text-gray-400">{counts.mine}</span>}
                            </button>
                            <button
                                onClick={() => onFilterChange?.('unassigned')}
                                className={cn(
                                    "flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors",
                                    filter === 'unassigned' ? "bg-white text-blue-600 shadow-xs" : "text-gray-600 hover:text-gray-900"
                                )}
                            >
                                Unassigned {counts.unassigned > 0 && <span className="ml-1 text-gray-400">{counts.unassigned}</span>}
                            </button>
                            <button
                                onClick={() => onFilterChange?.('all')}
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
                            onClick={() => onShowResolvedChange?.(!showResolved)}
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
                        endReached={() => {
                            if (isSearchMode || !hasMore || !onLoadMore || isLoadingMore) return;
                            onLoadMore();
                        }}
                        components={{
                            Footer: () => (!isSearchMode && (hasMore || isLoadingMore)) ? (
                                <div className="w-full py-3 text-sm text-indigo-600 flex items-center justify-center gap-2">
                                    <Loader2 size={14} className={cn(isLoadingMore ? 'animate-spin' : '')} />
                                    {isLoadingMore ? 'Loading...' : 'Scroll for more'}
                                </div>
                            ) : null
                        }}
                        itemContent={(index: number, conv: Conversation) => {
                            const name = getDisplayName(conv);
                            const { subject, preview, showPaperclip } = getPreview(conv);
                            const initials = getInitials(name);

                            return (
                                <ConversationItem
                                    key={conv.id}
                                    conv={conv}
                                    isSelected={selectedId === conv.id}
                                    isSelectionMode={isSelectionMode}
                                    isBulkSelected={selectedIds.has(conv.id)}
                                    hasDraft={draftIds.has(conv.id)}
                                    onSelect={onSelect}
                                    onPreload={onPreload}
                                    onToggleSelection={toggleSelection}
                                    displayName={name}
                                    initials={initials}
                                    subject={subject}
                                    preview={preview}
                                    showPaperclip={showPaperclip}
                                    lastCustomerTime={getLastCustomerMessageTime(conv)}
                                />
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
