import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Mail, Instagram, Facebook, Music2, Search, Filter } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface Conversation {
    id: string;
    customerName: string;
    lastMessage: string;
    channel: string;
    unread: boolean;
    updatedAt: string;
}

const CHANNEL_CONFIG: Record<string, { icon: typeof Mail; color: string; bg: string }> = {
    email: { icon: Mail, color: 'text-blue-600', bg: 'bg-blue-100' },
    facebook: { icon: Facebook, color: 'text-blue-700', bg: 'bg-blue-100' },
    instagram: { icon: Instagram, color: 'text-pink-600', bg: 'bg-pink-100' },
    tiktok: { icon: Music2, color: 'text-gray-900', bg: 'bg-gray-100' },
    default: { icon: MessageSquare, color: 'text-gray-600', bg: 'bg-gray-100' }
};

const FILTER_OPTIONS = ['All', 'Unread', 'Email', 'Social'];

export function MobileInbox() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);

    useEffect(() => {
        fetchConversations();
    }, [currentAccount, token]);

    const fetchConversations = async () => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch('/api/conversations?limit=50', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!response.ok) throw new Error('Failed to fetch');

            const data = await response.json();
            const convos = (data.conversations || data || []).map((c: any) => ({
                id: c.id,
                customerName: c.customerName || c.customerEmail || 'Unknown',
                lastMessage: c.lastMessage?.body || c.snippet || 'No messages',
                channel: c.channel || 'email',
                unread: c.status === 'open' || c.unreadCount > 0,
                updatedAt: c.updatedAt
            }));
            setConversations(convos);
        } catch (error) {
            console.error('[MobileInbox] Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatTimeAgo = (date: string) => {
        if (!date) return '';
        const now = new Date();
        const then = new Date(date);
        const diff = Math.floor((now.getTime() - then.getTime()) / 1000);
        if (diff < 60) return 'Now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
        return then.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    };

    const getChannelConfig = (channel: string) =>
        CHANNEL_CONFIG[channel.toLowerCase()] || CHANNEL_CONFIG.default;

    const getInitials = (name: string) =>
        name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    const filteredConversations = conversations.filter(c => {
        if (activeFilter === 'Unread' && !c.unread) return false;
        if (activeFilter === 'Email' && c.channel !== 'email') return false;
        if (activeFilter === 'Social' && c.channel === 'email') return false;
        if (searchQuery && !c.customerName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const unreadCount = conversations.filter(c => c.unread).length;

    if (loading) {
        return (
            <div className="space-y-3 animate-pulse">
                <div className="flex items-center justify-between">
                    <div className="h-8 bg-gray-200 rounded w-24" />
                    <div className="h-6 w-8 bg-gray-200 rounded-full" />
                </div>
                <div className="flex gap-2">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-9 w-20 bg-gray-200 rounded-full flex-shrink-0" />
                    ))}
                </div>
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex gap-4 p-4 bg-white rounded-2xl">
                        <div className="w-14 h-14 bg-gray-200 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                            <div className="h-5 bg-gray-200 rounded w-2/3" />
                            <div className="h-4 bg-gray-200 rounded w-full" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
                    {unreadCount > 0 && (
                        <span className="px-2.5 py-0.5 bg-indigo-600 text-white text-sm font-semibold rounded-full">
                            {unreadCount}
                        </span>
                    )}
                </div>
                <button
                    onClick={() => setShowSearch(!showSearch)}
                    className="p-2 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
                >
                    <Search size={22} className="text-gray-600" />
                </button>
            </div>

            {/* Search Bar (Expandable) */}
            {showSearch && (
                <div className="relative animate-in slide-in-from-top-2 duration-200">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                        className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base"
                    />
                </div>
            )}

            {/* Filter Chips */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
                {FILTER_OPTIONS.map((filter) => (
                    <button
                        key={filter}
                        onClick={() => setActiveFilter(filter)}
                        className={`
                            px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all
                            ${activeFilter === filter
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                                : 'bg-white text-gray-700 border border-gray-200 active:bg-gray-50'
                            }
                        `}
                    >
                        {filter}
                        {filter === 'Unread' && unreadCount > 0 && (
                            <span className={`ml-1.5 ${activeFilter === filter ? 'text-indigo-200' : 'text-gray-400'}`}>
                                ({unreadCount})
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Conversation List */}
            <div className="space-y-2">
                {filteredConversations.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                            <MessageSquare className="text-gray-400" size={36} />
                        </div>
                        <p className="text-gray-900 font-semibold mb-1">No conversations</p>
                        <p className="text-gray-500 text-sm">Messages will appear here</p>
                    </div>
                ) : (
                    filteredConversations.map((convo) => {
                        const channelConfig = getChannelConfig(convo.channel);
                        const ChannelIcon = channelConfig.icon;

                        return (
                            <button
                                key={convo.id}
                                onClick={() => navigate(`/m/inbox/${convo.id}`)}
                                className={`
                                    w-full flex items-center gap-4 p-4 rounded-2xl text-left
                                    transition-all active:scale-[0.98]
                                    ${convo.unread
                                        ? 'bg-white shadow-sm border border-gray-100'
                                        : 'bg-gray-50/50 hover:bg-gray-100/50'
                                    }
                                `}
                            >
                                {/* Avatar */}
                                <div className="relative flex-shrink-0">
                                    <div className={`
                                        w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg
                                        ${convo.unread
                                            ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
                                            : 'bg-gradient-to-br from-gray-400 to-gray-500'
                                        }
                                    `}>
                                        {getInitials(convo.customerName)}
                                    </div>
                                    {/* Channel Badge */}
                                    <div className={`
                                        absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full 
                                        ${channelConfig.bg} 
                                        flex items-center justify-center ring-2 ring-white
                                    `}>
                                        <ChannelIcon size={12} className={channelConfig.color} />
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-base truncate ${convo.unread ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                                            {convo.customerName}
                                        </span>
                                        <span className="text-xs text-gray-500 flex-shrink-0 ml-3">
                                            {formatTimeAgo(convo.updatedAt)}
                                        </span>
                                    </div>
                                    <p className={`text-sm line-clamp-2 ${convo.unread ? 'text-gray-700' : 'text-gray-500'}`}>
                                        {convo.lastMessage}
                                    </p>
                                </div>

                                {/* Unread Indicator */}
                                {convo.unread && (
                                    <div className="w-3 h-3 bg-indigo-600 rounded-full flex-shrink-0 animate-pulse" />
                                )}
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
}
