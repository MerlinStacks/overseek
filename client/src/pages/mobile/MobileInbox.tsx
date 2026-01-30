import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Mail, Instagram, Facebook, Music2, Search, Archive, CheckCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useSocket } from '../../context/SocketContext';
import { SwipeableRow } from '../../components/ui/SwipeableRow';
import { formatTimeAgo } from '../../utils/format';
import { getInitials } from '../../utils/string';
import { InboxSkeleton } from '../../components/mobile/MobileSkeleton';

interface ConversationApiResponse {
    id: string;
    wooCustomer?: {
        firstName?: string;
        lastName?: string;
        email?: string;
    };
    guestName?: string;
    guestEmail?: string;
    messages?: { content?: string }[];
    channel?: string;
    isRead?: boolean;
    updatedAt?: string;
}

interface Conversation {
    id: string;
    customerName: string;
    lastMessage: string;
    channel: string;
    unread: boolean;
    updatedAt: string;
}

/**
 * Dark-mode channel config with colors matching glassmorphism theme.
 */
const CHANNEL_CONFIG: Record<string, { icon: typeof Mail; color: string; bg: string }> = {
    email: { icon: Mail, color: 'text-blue-400', bg: 'bg-blue-500/20' },
    facebook: { icon: Facebook, color: 'text-blue-400', bg: 'bg-blue-500/20' },
    instagram: { icon: Instagram, color: 'text-pink-400', bg: 'bg-pink-500/20' },
    tiktok: { icon: Music2, color: 'text-slate-300', bg: 'bg-slate-500/20' },
    default: { icon: MessageSquare, color: 'text-slate-400', bg: 'bg-slate-500/20' }
};

const FILTER_OPTIONS = ['All', 'Unread', 'Email', 'Social'];

/**
 * MobileInbox - Premium dark-mode inbox for PWA.
 * Features swipe actions, search, and channel filters.
 */
export function MobileInbox() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);

    /**
     * Triggers haptic feedback if supported.
     */
    const triggerHaptic = (duration = 10) => {
        if ('vibrate' in navigator) {
            navigator.vibrate(duration);
        }
    };

    useEffect(() => {
        fetchConversations();
        const handleRefresh = () => fetchConversations();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [currentAccount, token]);

    // Socket listener for real-time updates
    const { socket } = useSocket();
    useEffect(() => {
        if (!socket || !currentAccount) return;

        /**
         * Handle new/updated conversations from socket events.
         * Refreshes conversation list to get full data.
         */
        const handleConversationUpdated = () => {
            // Trigger haptic on incoming message
            triggerHaptic(5);
            fetchConversations();
        };

        socket.on('conversation:updated', handleConversationUpdated);

        return () => {
            socket.off('conversation:updated', handleConversationUpdated);
        };
    }, [socket, currentAccount]);

    const fetchConversations = async () => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch('/api/chat/conversations?status=OPEN&limit=50', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!response.ok) throw new Error('Failed to fetch');

            const data = await response.json();
            const rawConvos = Array.isArray(data) ? data : (data.conversations || []);
            const convos = rawConvos.map((c: ConversationApiResponse) => {
                const customerName = c.wooCustomer
                    ? `${c.wooCustomer.firstName || ''} ${c.wooCustomer.lastName || ''}`.trim() || c.wooCustomer.email
                    : c.guestName || c.guestEmail || 'Unknown';

                const lastMessage = c.messages?.[0]?.content || 'No messages yet';

                return {
                    id: c.id,
                    customerName: customerName || 'Unknown',
                    lastMessage,
                    channel: c.channel || 'CHAT',
                    unread: !c.isRead,
                    updatedAt: c.updatedAt || ''
                };
            });
            setConversations(convos);
        } catch (error) {
            Logger.error('[MobileInbox] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    };

    const handleArchive = async (id: string) => {
        triggerHaptic(15);
        setConversations(prev => prev.filter(c => c.id !== id));

        try {
            await fetch(`/api/chat/${id}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'closed' })
            });
        } catch (error) {
            Logger.error('[MobileInbox] Archive failed:', { error: error });
            fetchConversations();
        }
    };

    const handleMarkRead = async (id: string) => {
        triggerHaptic(10);
        setConversations(prev => prev.map(c =>
            c.id === id ? { ...c, unread: false } : c
        ));

        try {
            await fetch(`/api/chat/${id}/read`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id
                }
            });
        } catch (error) {
            Logger.error('[MobileInbox] Mark read failed:', { error: error });
        }
    };

    const getChannelConfig = (channel: string) =>
        CHANNEL_CONFIG[channel.toLowerCase()] || CHANNEL_CONFIG.default;

    const filteredConversations = conversations.filter(c => {
        if (activeFilter === 'Unread' && !c.unread) return false;
        if (activeFilter === 'Email' && c.channel !== 'email') return false;
        if (activeFilter === 'Social' && c.channel === 'email') return false;
        if (searchQuery && !c.customerName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const unreadCount = conversations.filter(c => c.unread).length;

    if (loading) {
        return <InboxSkeleton />;
    }

    return (
        <div className="min-h-full flex flex-col space-y-4 animate-fade-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-white">Inbox</h1>
                    {unreadCount > 0 && (
                        <span className="px-2.5 py-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold rounded-full shadow-lg shadow-indigo-500/30">
                            {unreadCount}
                        </span>
                    )}
                </div>
                <button
                    onClick={() => {
                        triggerHaptic();
                        setShowSearch(!showSearch);
                    }}
                    className="p-2.5 rounded-xl bg-slate-800/50 backdrop-blur-sm border border-white/10 active:bg-slate-700/50 transition-colors"
                >
                    <Search size={20} className="text-slate-300" />
                </button>
            </div>

            {/* Search Bar (Expandable) */}
            {showSearch && (
                <div className="relative animate-fade-slide-up">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-slate-700/50">
                        <Search size={14} className="text-slate-400" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                        className="w-full pl-14 pr-4 py-3.5 bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                    />
                </div>
            )}

            {/* Filter Chips */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                {FILTER_OPTIONS.map((filter) => {
                    const isActive = activeFilter === filter;
                    return (
                        <button
                            key={filter}
                            onClick={() => {
                                triggerHaptic();
                                setActiveFilter(filter);
                            }}
                            className={`
                                px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all active:scale-95
                                ${isActive
                                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                                    : 'bg-slate-800/50 backdrop-blur-sm border border-white/10 text-slate-300'
                                }
                            `}
                        >
                            {filter}
                            {filter === 'Unread' && unreadCount > 0 && (
                                <span className={`ml-1.5 ${isActive ? 'text-indigo-200' : 'text-slate-500'}`}>
                                    ({unreadCount})
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Swipe Hint */}
            {filteredConversations.length > 0 && (
                <p className="text-xs text-slate-500 text-center">
                    ← Swipe left to archive • Swipe right to mark read →
                </p>
            )}

            {/* Conversation List */}
            <div className="flex-1 space-y-2">
                {filteredConversations.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 mx-auto mb-4 bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl flex items-center justify-center">
                            <MessageSquare className="text-slate-500" size={36} />
                        </div>
                        <p className="text-white font-semibold mb-1">No conversations</p>
                        <p className="text-slate-400 text-sm">Messages will appear here</p>
                    </div>
                ) : (
                    filteredConversations.map((convo, index) => {
                        const channelConfig = getChannelConfig(convo.channel);
                        const ChannelIcon = channelConfig.icon;

                        return (
                            <SwipeableRow
                                key={convo.id}
                                leftAction={convo.unread ? {
                                    icon: <CheckCheck size={24} className="text-white" />,
                                    color: 'bg-emerald-500',
                                    onAction: () => handleMarkRead(convo.id)
                                } : undefined}
                                rightAction={{
                                    icon: <Archive size={24} className="text-white" />,
                                    color: 'bg-slate-600',
                                    onAction: () => handleArchive(convo.id)
                                }}
                            >
                                <button
                                    onClick={() => {
                                        triggerHaptic();
                                        navigate(`/m/inbox/${convo.id}`);
                                    }}
                                    className="w-full flex items-center gap-4 p-4 bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl active:bg-slate-700/50 transition-all animate-fade-slide-up"
                                    style={{ animationDelay: `${index * 30}ms` }}
                                >
                                    {/* Avatar */}
                                    <div className="relative flex-shrink-0">
                                        <div className={`
                                            w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg
                                            ${convo.unread
                                                ? 'bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30'
                                                : 'bg-slate-700'
                                            }
                                        `}>
                                            {getInitials(convo.customerName)}
                                        </div>
                                        {/* Channel Badge */}
                                        <div className={`
                                            absolute -bottom-1 -right-1 w-6 h-6 rounded-lg 
                                            ${channelConfig.bg} 
                                            flex items-center justify-center ring-2 ring-slate-900
                                        `}>
                                            <ChannelIcon size={12} className={channelConfig.color} />
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0 text-left">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={`text-base truncate ${convo.unread ? 'font-bold text-white' : 'font-medium text-slate-300'}`}>
                                                {convo.customerName}
                                            </span>
                                            <span className="text-xs text-slate-500 flex-shrink-0 ml-3">
                                                {formatTimeAgo(convo.updatedAt)}
                                            </span>
                                        </div>
                                        <p className={`text-sm line-clamp-2 ${convo.unread ? 'text-slate-300' : 'text-slate-500'}`}>
                                            {convo.lastMessage}
                                        </p>
                                    </div>

                                    {/* Unread Indicator */}
                                    {convo.unread && (
                                        <div className="w-3 h-3 bg-indigo-500 rounded-full flex-shrink-0 animate-pulse shadow-lg shadow-indigo-500/50" />
                                    )}
                                </button>
                            </SwipeableRow>
                        );
                    })
                )}
            </div>
        </div>
    );
}
