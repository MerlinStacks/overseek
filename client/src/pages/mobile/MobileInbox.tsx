import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MessageSquare, Mail, Instagram, Facebook, Music2, Search, Archive, CheckCheck, Sparkles, Plus, Zap } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useSocket } from '../../context/SocketContext';
import { useHaptic } from '../../hooks/useHaptic';
import { SwipeableRow } from '../../components/ui/SwipeableRow';
import { formatTimeAgo } from '../../utils/format';
import { getInitials } from '../../utils/string';
import { InboxSkeleton } from '../../components/mobile/MobileSkeleton';
import { NewEmailModal } from '../../components/chat/NewEmailModal';

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

interface SharedComposeDraft {
    subject?: string;
    body?: string;
    timestamp?: number;
}

/**
 * Dark-mode channel config with colors matching glassmorphism theme.
 */
const CHANNEL_CONFIG: Record<string, { icon: typeof Mail; color: string; bg: string; ring: string; label: string }> = {
    chat: { icon: MessageSquare, color: 'text-emerald-100', bg: 'bg-emerald-400/15', ring: 'ring-emerald-300/20', label: 'Chat' },
    email: { icon: Mail, color: 'text-sky-100', bg: 'bg-sky-400/15', ring: 'ring-sky-300/20', label: 'Email' },
    facebook: { icon: Facebook, color: 'text-blue-100', bg: 'bg-blue-400/15', ring: 'ring-blue-300/20', label: 'Facebook' },
    instagram: { icon: Instagram, color: 'text-pink-100', bg: 'bg-pink-400/15', ring: 'ring-pink-300/20', label: 'Instagram' },
    tiktok: { icon: Music2, color: 'text-slate-100', bg: 'bg-slate-400/15', ring: 'ring-white/10', label: 'TikTok' },
    default: { icon: MessageSquare, color: 'text-slate-200', bg: 'bg-slate-400/15', ring: 'ring-white/10', label: 'Message' }
};

const FILTER_OPTIONS = [
    { label: 'Command', value: 'All', helper: 'Open threads' },
    { label: 'Unread', value: 'Unread', helper: 'Needs reply' },
    { label: 'Email', value: 'Email', helper: 'Mail only' },
    { label: 'Social', value: 'Social', helper: 'DM channels' },
] as const;
const SOCIAL_CHANNELS = new Set(['facebook', 'instagram', 'tiktok']);

/**
 * MobileInbox - Premium dark-mode inbox for PWA.
 * Features swipe actions, search, and channel filters.
 */
export function MobileInbox() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { triggerHaptic } = useHaptic();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [composeDraft, setComposeDraft] = useState<SharedComposeDraft | null>(null);

    const fetchConversations = useCallback(async (initialLoad = false) => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        try {
            if (initialLoad) setLoading(true);
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
                    channel: (c.channel || 'CHAT').toLowerCase(),
                    unread: !c.isRead,
                    updatedAt: c.updatedAt || ''
                };
            });
            setConversations(convos);
        } catch (error) {
            Logger.error('[MobileInbox] Error:', { error: error });
        } finally {
            if (initialLoad) setLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchConversations(true);
        const handleRefresh = () => fetchConversations();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [fetchConversations]);

    useEffect(() => {
        const shouldCompose = searchParams.get('compose') === 'true';
        if (!shouldCompose) {
            setComposeDraft(null);
            return;
        }

        try {
            const rawDraft = sessionStorage.getItem('sharedContent');
            if (rawDraft) {
                const parsedDraft = JSON.parse(rawDraft) as SharedComposeDraft;
                setComposeDraft(parsedDraft);
                return;
            }
        } catch (error) {
            Logger.error('[MobileInbox] Failed to parse shared compose draft', { error });
        }

        setComposeDraft({});
    }, [searchParams]);

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

        const handleConversationRead = ({ id }: { id: string }) => {
            setConversations(prev => prev.map(c =>
                c.id === id ? { ...c, unread: false } : c
            ));
        };

        socket.on('conversation:updated', handleConversationUpdated);
        socket.on('conversation:read', handleConversationRead);

        return () => {
            socket.off('conversation:updated', handleConversationUpdated);
            socket.off('conversation:read', handleConversationRead);
        };
    }, [socket, currentAccount, fetchConversations, triggerHaptic]);

    const handleArchive = async (id: string) => {
        if (!currentAccount) return;
        triggerHaptic(15);
        setConversations(prev => prev.filter(c => c.id !== id));

        try {
            const res = await fetch(`/api/chat/${id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'CLOSED' })
            });

            if (!res.ok) {
                throw new Error(`Archive failed with status ${res.status}`);
            }
        } catch (error) {
            Logger.error('[MobileInbox] Archive failed:', { error: error });
            fetchConversations();
        }
    };

    const handleMarkRead = async (id: string) => {
        if (!currentAccount) return;
        triggerHaptic(10);
        setConversations(prev => prev.map(c =>
            c.id === id ? { ...c, unread: false } : c
        ));

        try {
            const res = await fetch(`/api/chat/${id}/read`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!res.ok) {
                throw new Error(`Mark read failed with status ${res.status}`);
            }
        } catch (error) {
            Logger.error('[MobileInbox] Mark read failed:', { error: error });
            fetchConversations();
        }
    };

    const getChannelConfig = (channel: string) =>
        CHANNEL_CONFIG[channel.toLowerCase()] || CHANNEL_CONFIG.default;

    const filteredConversations = conversations.filter(c => {
        if (activeFilter === 'Unread' && !c.unread) return false;
        if (activeFilter === 'Email' && c.channel !== 'email') return false;
        if (activeFilter === 'Social' && !SOCIAL_CHANNELS.has(c.channel)) return false;
        if (searchQuery && !c.customerName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const unreadCount = conversations.filter(c => c.unread).length;
    const emailCount = conversations.filter(c => c.channel === 'email').length;
    const socialCount = conversations.filter(c => SOCIAL_CHANNELS.has(c.channel)).length;
    const activeCount = activeFilter === 'Unread'
        ? unreadCount
        : activeFilter === 'Email'
            ? emailCount
            : activeFilter === 'Social'
                ? socialCount
                : conversations.length;

    const closeCompose = () => {
        setComposeDraft(null);
        sessionStorage.removeItem('sharedContent');
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('compose');
        setSearchParams(nextParams, { replace: true });
    };

    if (loading) {
        return <InboxSkeleton />;
    }

    return (
        <div className="min-h-full flex flex-col space-y-4 pb-28 animate-fade-slide-up">
            <div className="rounded-[2rem] border border-white/10 bg-slate-950 px-4 py-5 shadow-2xl shadow-black/30">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-violet-400/10 px-2.5 py-1 text-xs font-semibold text-violet-100 ring-1 ring-violet-300/20"><Sparkles size={12} /> Inbox command</p>
                        <h1 className="text-3xl font-black tracking-tight text-white">Inbox</h1>
                        <p className="mt-1 text-sm text-slate-400">{activeCount.toLocaleString()} active · {unreadCount.toLocaleString()} unread</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                triggerHaptic();
                                setShowSearch(!showSearch);
                            }}
                            className="rounded-2xl bg-white/10 p-3 text-slate-200 active:scale-95"
                            aria-label="Search conversations"
                        >
                            <Search size={18} />
                        </button>
                        <button
                            onClick={() => {
                                triggerHaptic();
                                setComposeDraft({});
                            }}
                            className="rounded-2xl bg-white p-3 text-slate-950 active:scale-95"
                            aria-label="Compose email"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                    <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10"><p className="text-xl font-black text-white">{conversations.length}</p><p className="text-[11px] font-medium text-slate-400">Open</p></div>
                    <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10"><p className="text-xl font-black text-white">{unreadCount}</p><p className="text-[11px] font-medium text-slate-400">Unread</p></div>
                    <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10"><p className="text-xl font-black text-white">{socialCount}</p><p className="text-[11px] font-medium text-slate-400">Social</p></div>
                </div>
            </div>

            {showSearch && (
                <div className="sticky top-2 z-10 animate-fade-slide-up">
                    <div className="relative rounded-2xl border border-white/10 bg-slate-950/90 shadow-xl shadow-black/20 backdrop-blur-xl">
                        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="search"
                            placeholder="Search conversations..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoFocus
                            className="w-full bg-transparent py-3.5 pl-11 pr-4 text-[15px] text-white placeholder-slate-500 outline-none"
                        />
                    </div>
                </div>
            )}

            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
                {FILTER_OPTIONS.map((filter) => {
                    const isActive = activeFilter === filter.value;
                    const count = filter.value === 'All' ? conversations.length : filter.value === 'Unread' ? unreadCount : filter.value === 'Email' ? emailCount : socialCount;
                    return (
                        <button
                            key={filter.value}
                            onClick={() => {
                                triggerHaptic();
                                setActiveFilter(filter.value);
                            }}
                            className={`min-w-[116px] rounded-2xl px-3 py-3 text-left transition active:scale-95 ${isActive ? 'bg-white text-slate-950 shadow-lg' : 'bg-slate-900/80 text-slate-300 ring-1 ring-white/10'}`}
                        >
                            <span className="block text-sm font-black">{filter.label}</span>
                            <span className={`mt-1 block text-xs ${isActive ? 'text-slate-500' : 'text-slate-500'}`}>{count.toLocaleString()} · {filter.helper}</span>
                        </button>
                    );
                })}
            </div>

            {filteredConversations.length > 0 && (
                <p className="text-center text-xs text-slate-500">
                    <Zap size={12} className="mr-1 inline" />Swipe right to mark read. Swipe left to archive.
                </p>
            )}

            <div className="flex-1 space-y-2">
                {filteredConversations.length === 0 ? (
                    <div className="rounded-[2rem] border border-white/10 bg-slate-950 px-5 py-14 text-center">
                        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/[0.06]">
                            <MessageSquare className="text-slate-500" size={36} />
                        </div>
                        <p className="mb-1 font-black text-white">No conversations</p>
                        <p className="text-sm text-slate-400">Switch filters or clear search to widen the list.</p>
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
                                    className="flex w-full items-center gap-4 rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 text-left shadow-lg shadow-black/20 transition active:scale-[0.99] animate-fade-slide-up"
                                    style={{ animationDelay: `${index * 15}ms` }}
                                >
                                    <div className="relative flex-shrink-0">
                                        <div className={`
                                            flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-black text-white
                                            ${convo.unread
                                                ? 'bg-indigo-500 shadow-lg shadow-indigo-500/30'
                                                : 'bg-white/[0.08] ring-1 ring-white/10'
                                            }
                                        `}>
                                            {getInitials(convo.customerName)}
                                        </div>
                                        <div className={`
                                            absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-xl ring-2 ring-slate-950
                                            ${channelConfig.bg} 
                                            ${channelConfig.ring}
                                        `}>
                                            <ChannelIcon size={12} className={channelConfig.color} />
                                        </div>
                                    </div>

                                    <div className="flex-1 min-w-0 text-left">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={`truncate text-base ${convo.unread ? 'font-black text-white' : 'font-bold text-slate-300'}`}>
                                                {convo.customerName}
                                            </span>
                                            <span className="text-xs text-slate-500 flex-shrink-0 ml-3">
                                                {formatTimeAgo(convo.updatedAt)}
                                            </span>
                                        </div>
                                        <p className={`line-clamp-2 text-sm ${convo.unread ? 'text-slate-300' : 'text-slate-500'}`}>
                                            {convo.lastMessage}
                                        </p>
                                        <div className="mt-3 flex items-center gap-2">
                                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${channelConfig.bg} ${channelConfig.color} ring-1 ${channelConfig.ring}`}>{channelConfig.label}</span>
                                            {convo.unread ? <span className="rounded-full bg-indigo-400/15 px-2.5 py-1 text-[11px] font-bold text-indigo-100 ring-1 ring-indigo-300/20">Needs reply</span> : <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-bold text-slate-400 ring-1 ring-white/10">Handled</span>}
                                        </div>
                                    </div>

                                    {convo.unread && (
                                        <div className="h-3 w-3 flex-shrink-0 animate-pulse rounded-full bg-indigo-400 shadow-lg shadow-indigo-500/50" />
                                    )}
                                </button>
                            </SwipeableRow>
                        );
                    })
                )}
            </div>

            {composeDraft && (
                <NewEmailModal
                    onClose={closeCompose}
                    onSent={async (conversationId) => {
                        closeCompose();
                        await fetchConversations();
                        navigate(`/m/inbox/${conversationId}`);
                    }}
                    initialSubject={composeDraft.subject || ''}
                    initialBody={composeDraft.body || ''}
                />
            )}
        </div>
    );
}
