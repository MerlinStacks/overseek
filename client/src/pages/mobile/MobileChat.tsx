import { useState, useEffect, useRef, useMemo } from 'react';
import { Logger } from '../../utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Paperclip, MoreVertical, CheckCircle2, Ban, X, Mail, Instagram, Facebook, Music2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import DOMPurify from 'dompurify';

interface MessageApiResponse {
    id: string;
    content?: string;
    senderType?: 'AGENT' | 'CUSTOMER';
    createdAt?: string;
    sender?: { fullName?: string };
}

interface Message {
    id: string;
    body: string;
    direction: 'inbound' | 'outbound';
    createdAt: string;
    senderName?: string;
}

interface Conversation {
    id: string;
    customerName: string;
    customerEmail?: string;
    channel: string;
    status: string;
}

const CHANNEL_CONFIG: Record<string, { icon: typeof Mail; color: string; bg: string; label: string }> = {
    email: { icon: Mail, color: 'text-blue-600', bg: 'bg-blue-100', label: 'Email' },
    facebook: { icon: Facebook, color: 'text-blue-700', bg: 'bg-blue-100', label: 'Facebook' },
    instagram: { icon: Instagram, color: 'text-pink-600', bg: 'bg-pink-100', label: 'Instagram' },
    tiktok: { icon: Music2, color: 'text-gray-900', bg: 'bg-gray-100', label: 'TikTok' },
};

export function MobileChat() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [conversation, setConversation] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showMenu, setShowMenu] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        fetchConversation();
        // Listen for refresh events from pull-to-refresh
        const handleRefresh = () => fetchConversation();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [id, currentAccount, token]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const fetchConversation = async () => {
        if (!currentAccount || !token || !id) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount.id
            };

            // Fetch conversation details - use /api/chat/:id which returns conversation with messages
            const convRes = await fetch(`/api/chat/${id}`, { headers });
            if (convRes.ok) {
                const conv = await convRes.json();
                // Build customer name from wooCustomer or guest fields
                const customerName = conv.wooCustomer
                    ? `${conv.wooCustomer.firstName || ''} ${conv.wooCustomer.lastName || ''}`.trim() || conv.wooCustomer.email
                    : conv.guestName || conv.guestEmail || 'Unknown';

                setConversation({
                    id: conv.id,
                    customerName,
                    customerEmail: conv.wooCustomer?.email || conv.guestEmail,
                    channel: conv.channel || 'CHAT',
                    status: conv.status
                });

                // Messages are included in the conversation response
                if (conv.messages && Array.isArray(conv.messages)) {
                    setMessages(conv.messages.map((m: MessageApiResponse) => ({
                        id: m.id,
                        body: m.content || '',
                        direction: m.senderType === 'AGENT' ? 'outbound' : 'inbound',
                        createdAt: m.createdAt || '',
                        senderName: m.sender?.fullName || (m.senderType === 'AGENT' ? 'Agent' : 'Customer')
                    })));
                }
            }
        } catch (error) {
            Logger.error('[MobileChat] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    };

    const handleSend = async () => {
        if (!newMessage.trim() || sending || !currentAccount || !token) return;

        setSending(true);
        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(10);
        }

        try {
            const res = await fetch(`/api/chat/${id}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ content: newMessage.trim() })
            });

            if (res.ok) {
                const sent = await res.json();
                setMessages(prev => [...prev, {
                    id: sent.id || Date.now().toString(),
                    body: newMessage.trim(),
                    direction: 'outbound',
                    createdAt: new Date().toISOString()
                }]);
                setNewMessage('');
                inputRef.current?.focus();
            }
        } catch (error) {
            Logger.error('[MobileChat] Send error:', { error: error });
        } finally {
            setSending(false);
        }
    };

    /** Mark conversation as resolved/closed */
    const handleResolve = async () => {
        setShowMenu(false);
        if (!currentAccount || !token) return;
        try {
            await fetch(`/api/chat/${id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'CLOSED' })
            });
            navigate('/m/inbox');
        } catch (error) {
            Logger.error('[MobileChat] Resolve error:', { error: error });
        }
    };

    /** Block the contact */
    const handleBlock = async () => {
        setShowMenu(false);
        if (!currentAccount || !token || !conversation?.customerEmail) return;
        try {
            await fetch('/api/chat/block', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: conversation.customerEmail, reason: 'Blocked from mobile' })
            });
            navigate('/m/inbox');
        } catch (error) {
            Logger.error('[MobileChat] Block error:', { error: error });
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatTime = (date: string) => {
        return new Date(date).toLocaleTimeString('en-AU', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const formatDate = (date: string) => {
        const d = new Date(date);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const isYesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();

        if (isToday) return 'Today';
        if (isYesterday) return 'Yesterday';
        return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    };

    const groupMessagesByDate = (msgs: Message[]) => {
        const groups: { date: string; messages: Message[] }[] = [];
        let currentDate = '';

        msgs.forEach(msg => {
            const msgDate = new Date(msg.createdAt).toDateString();
            if (msgDate !== currentDate) {
                currentDate = msgDate;
                groups.push({ date: msg.createdAt, messages: [msg] });
            } else {
                groups[groups.length - 1].messages.push(msg);
            }
        });

        return groups;
    };

    const channelConfig = conversation ? CHANNEL_CONFIG[conversation.channel] || CHANNEL_CONFIG.email : CHANNEL_CONFIG.email;
    const ChannelIcon = channelConfig.icon;

    if (loading) {
        return (
            <div className="fixed inset-0 bg-white z-50 flex flex-col animate-pulse">
                <div className="h-16 bg-gray-100" />
                <div className="flex-1 p-4 space-y-4">
                    <div className="h-16 bg-gray-100 rounded-2xl w-3/4" />
                    <div className="h-12 bg-gray-100 rounded-2xl w-1/2 ml-auto" />
                    <div className="h-20 bg-gray-100 rounded-2xl w-2/3" />
                </div>
                <div className="h-20 bg-gray-100" />
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
                <button
                    onClick={() => navigate('/m/inbox')}
                    className="p-2 -ml-2 rounded-full hover:bg-gray-100 active:bg-gray-200"
                >
                    <ArrowLeft size={24} />
                </button>
                <div className="flex-1 min-w-0">
                    <h1 className="font-bold text-gray-900 truncate">{conversation?.customerName}</h1>
                    <div className="flex items-center gap-1.5 text-sm text-gray-500">
                        <ChannelIcon size={14} className={channelConfig.color} />
                        <span>{channelConfig.label}</span>
                    </div>
                </div>
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-2 rounded-full hover:bg-gray-100"
                    >
                        <MoreVertical size={20} className="text-gray-600" />
                    </button>
                    {/* Dropdown Menu */}
                    {showMenu && (
                        <>
                            {/* Backdrop */}
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowMenu(false)}
                            />
                            {/* Menu */}
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-gray-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                                <button
                                    onClick={handleResolve}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                >
                                    <CheckCircle2 size={18} className="text-emerald-600" />
                                    <span>Mark Resolved</span>
                                </button>
                                {conversation?.customerEmail && (
                                    <button
                                        onClick={handleBlock}
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-red-600 hover:bg-red-50 active:bg-red-100"
                                    >
                                        <Ban size={18} />
                                        <span>Block Contact</span>
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500">No messages yet</p>
                    </div>
                ) : (
                    groupMessagesByDate(messages).map((group, gi) => (
                        <div key={gi}>
                            {/* Date separator */}
                            <div className="flex items-center justify-center my-4">
                                <span className="px-3 py-1 bg-gray-200 text-gray-600 text-xs font-medium rounded-full">
                                    {formatDate(group.date)}
                                </span>
                            </div>

                            {/* Messages */}
                            {group.messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`flex mb-2 ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div
                                        className={`max-w-[80%] px-4 py-3 rounded-2xl ${msg.direction === 'outbound'
                                            ? 'bg-indigo-600 text-white rounded-br-md'
                                            : 'bg-white text-gray-900 rounded-bl-md shadow-sm border border-gray-100'
                                            }`}
                                    >
                                        {/* Render HTML content or plain text */}
                                        {/<[a-z][\s\S]*>/i.test(msg.body) ? (
                                            <div
                                                className="text-sm [&_a]:text-indigo-300 [&_a]:underline [&_img]:max-w-full [&_img]:rounded"
                                                dangerouslySetInnerHTML={{
                                                    __html: DOMPurify.sanitize(msg.body, {
                                                        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'div', 'span'],
                                                        ALLOWED_ATTR: ['href', 'target', 'rel']
                                                    })
                                                }}
                                            />
                                        ) : (
                                            <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                                        )}
                                        <p className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-indigo-200' : 'text-gray-400'
                                            }`}>
                                            {formatTime(msg.createdAt)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Message Composer */}
            <div
                className="bg-white border-t border-gray-200 p-3"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
            >
                <div className="flex items-end gap-2">
                    <button className="p-2 rounded-full hover:bg-gray-100 flex-shrink-0">
                        <Paperclip size={22} className="text-gray-500" />
                    </button>
                    <div className="flex-1 bg-gray-100 rounded-2xl px-4 py-2">
                        <textarea
                            ref={inputRef}
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={handleKeyPress}
                            placeholder="Type a message..."
                            rows={1}
                            className="w-full bg-transparent resize-none focus:outline-none text-base max-h-32"
                            style={{ minHeight: '24px' }}
                        />
                    </div>
                    <button
                        onClick={handleSend}
                        disabled={!newMessage.trim() || sending}
                        className={`p-3 rounded-full flex-shrink-0 transition-all ${newMessage.trim() && !sending
                            ? 'bg-indigo-600 text-white active:scale-95'
                            : 'bg-gray-200 text-gray-400'
                            }`}
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
