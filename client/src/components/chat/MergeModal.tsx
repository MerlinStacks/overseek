import { useState, useEffect } from 'react';
import { Merge, X, Search, MessageSquare } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { format } from 'date-fns';

interface Conversation {
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    guestEmail?: string;
    guestName?: string;
    wooCustomer?: {
        firstName?: string;
        lastName?: string;
        email?: string;
    };
    messages?: {
        content: string;
    }[];
}

interface MergeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onMerge: (targetConversationId: string) => Promise<void>;
    currentConversationId: string;
}

/**
 * Modal component for merging conversations.
 * Shows a searchable list of other conversations to merge with.
 */
export function MergeModal({ isOpen, onClose, onMerge, currentConversationId }: MergeModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isMerging, setIsMerging] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!isOpen || !token || !currentAccount) return;

        const fetchConversations = async () => {
            setIsLoading(true);
            try {
                const res = await fetch('/api/chat/conversations', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    // Filter out current conversation
                    setConversations(data.filter((c: Conversation) => c.id !== currentConversationId));
                }
            } catch (error) {
                console.error('Failed to fetch conversations:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchConversations();
    }, [isOpen, token, currentAccount, currentConversationId]);

    if (!isOpen) return null;

    const handleMerge = async (targetId: string) => {
        setIsMerging(true);
        try {
            await onMerge(targetId);
            onClose();
        } finally {
            setIsMerging(false);
        }
    };

    const getConversationName = (conv: Conversation) => {
        if (conv.wooCustomer) {
            const name = `${conv.wooCustomer.firstName || ''} ${conv.wooCustomer.lastName || ''}`.trim();
            return name || conv.wooCustomer.email || 'Customer';
        }
        return conv.guestName || conv.guestEmail || 'Anonymous';
    };

    const getLastMessage = (conv: Conversation) => {
        if (conv.messages && conv.messages.length > 0) {
            const content = conv.messages[0].content;
            // Strip HTML and truncate
            const plainText = content.replace(/<[^>]*>/g, '').trim();
            return plainText.slice(0, 60) + (plainText.length > 60 ? '...' : '');
        }
        return 'No messages';
    };

    const filteredConversations = conversations.filter(conv => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        const name = getConversationName(conv).toLowerCase();
        const email = (conv.wooCustomer?.email || conv.guestEmail || '').toLowerCase();
        return name.includes(query) || email.includes(query);
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-xs"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                        <Merge size={18} className="text-blue-600" />
                        <h3 className="font-semibold text-gray-900">Merge Conversation</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Search */}
                <div className="px-4 py-3 border-b border-gray-100">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search conversations..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                </div>

                {/* Content */}
                <div className="max-h-80 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                        </div>
                    ) : filteredConversations.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            {searchQuery ? 'No conversations match your search' : 'No other conversations to merge'}
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {filteredConversations.map((conv) => (
                                <button
                                    key={conv.id}
                                    onClick={() => handleMerge(conv.id)}
                                    disabled={isMerging}
                                    className={cn(
                                        "w-full flex items-start gap-3 px-4 py-3 transition-colors text-left",
                                        "hover:bg-blue-50",
                                        isMerging && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    <div className="w-9 h-9 rounded-full bg-gray-400 flex items-center justify-center text-white text-sm font-medium shrink-0">
                                        <MessageSquare size={16} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="font-medium text-gray-900 truncate">
                                                {getConversationName(conv)}
                                            </div>
                                            <div className="text-xs text-gray-400 shrink-0">
                                                {format(new Date(conv.updatedAt), 'MMM d')}
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-500 truncate mt-0.5">
                                            {getLastMessage(conv)}
                                        </div>
                                        <div className={cn(
                                            "inline-block mt-1 px-1.5 py-0.5 rounded-sm text-[10px] font-medium",
                                            conv.status === 'OPEN' && "bg-green-100 text-green-700",
                                            conv.status === 'CLOSED' && "bg-gray-100 text-gray-600",
                                            conv.status === 'SNOOZED' && "bg-yellow-100 text-yellow-700"
                                        )}>
                                            {conv.status}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                    <p className="text-xs text-gray-500 text-center">
                        Messages from the selected conversation will be merged into the current one
                    </p>
                </div>
            </div>
        </div>
    );
}
