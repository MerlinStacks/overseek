import { useState, useEffect, useRef } from 'react';
import { Logger } from '../../utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Paperclip, MoreVertical, CheckCircle2, Ban, X, Mail, Instagram, Facebook, Music2, Sparkles, Loader2, Zap } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useCannedResponses } from '../../hooks/useCannedResponses';
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
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    const [conversation, setConversation] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Canned responses
    const {
        cannedResponses,
        filteredCanned,
        showCanned,
        handleInputForCanned,
        selectCanned,
        setShowCanned
    } = useCannedResponses();

    // Build customer context for canned response placeholders
    const customerContext = conversation ? {
        firstName: conversation.customerName.split(' ')[0],
        lastName: conversation.customerName.split(' ').slice(1).join(' '),
        email: conversation.customerEmail,
        agentFirstName: user?.fullName?.split(' ')[0],
        agentFullName: user?.fullName ?? undefined
    } : undefined;

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

    /** Block the contact by conversation ID */
    const handleBlock = async () => {
        setShowMenu(false);
        if (!currentAccount || !token || !id) return;
        try {
            // Block by conversation ID - server will resolve the contact
            await fetch(`/api/chat/${id}/block`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ reason: 'Blocked from mobile' })
            });
            navigate('/m/inbox');
        } catch (error) {
            Logger.error('[MobileChat] Block error:', { error: error });
        }
    };

    /** Handle input change and detect canned response trigger */
    const handleInputChange = (value: string) => {
        setNewMessage(value);
        handleInputForCanned(value);
    };

    /** Handle canned response selection */
    const handleSelectCanned = (response: typeof cannedResponses[0]) => {
        const content = selectCanned(response, customerContext);
        setNewMessage(content);
        setShowCanned(false);
        inputRef.current?.focus();
    };

    /** Handle file upload */
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentAccount || !token) return;

        setIsUploading(true);
        if ('vibrate' in navigator) navigator.vibrate(10);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch(`/api/chat/${id}/attachments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: formData
            });

            if (res.ok) {
                const { url, filename } = await res.json();
                // Add attachment as a message with file link
                const attachmentMsg = `📎 [${filename}](${url})`;
                setNewMessage(prev => prev ? `${prev}\n${attachmentMsg}` : attachmentMsg);
                inputRef.current?.focus();
            }
        } catch (error) {
            Logger.error('[MobileChat] Upload error:', { error });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    /** Generate AI draft reply */
    const handleGenerateAIDraft = async () => {
        if (!currentAccount || !token || isGeneratingDraft) return;

        setIsGeneratingDraft(true);
        if ('vibrate' in navigator) navigator.vibrate(10);

        try {
            const res = await fetch(`/api/chat/${id}/ai-draft`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ currentDraft: newMessage || '' })
            });

            if (res.ok) {
                const { draft } = await res.json();
                setNewMessage(draft);
                inputRef.current?.focus();
            }
        } catch (error) {
            Logger.error('[MobileChat] AI draft error:', { error });
        } finally {
            setIsGeneratingDraft(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && !showCanned) {
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
            <div className="fixed inset-0 bg-slate-900 z-[60] flex flex-col animate-pulse">
                <div className="h-16 bg-slate-800" />
                <div className="flex-1 p-4 space-y-4">
                    <div className="h-16 bg-slate-800 rounded-2xl w-3/4" />
                    <div className="h-12 bg-slate-800 rounded-2xl w-1/2 ml-auto" />
                    <div className="h-20 bg-slate-800 rounded-2xl w-2/3" />
                </div>
                <div className="h-20 bg-slate-800" />
            </div>
        );
    }

    return (
        <div
            className="fixed inset-0 bg-slate-900 z-[60] flex flex-col"
            style={{ height: '100dvh', paddingTop: 'env(safe-area-inset-top)' }}
        >
            {/* Header */}
            <header className="flex-shrink-0 bg-slate-800/90 backdrop-blur-sm border-b border-white/10 px-4 py-3 flex items-center gap-3">
                <button
                    onClick={() => navigate('/m/inbox')}
                    className="p-2 -ml-2 rounded-full hover:bg-slate-700 active:bg-slate-600 text-white"
                >
                    <ArrowLeft size={24} />
                </button>
                <div className="flex-1 min-w-0">
                    <h1 className="font-bold text-white truncate">{conversation?.customerName}</h1>
                    <div className="flex items-center gap-1.5 text-sm text-slate-400">
                        <ChannelIcon size={14} className={channelConfig.color} />
                        <span>{channelConfig.label}</span>
                    </div>
                </div>
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-2 rounded-full hover:bg-slate-700"
                    >
                        <MoreVertical size={20} className="text-slate-300" />
                    </button>
                    {/* Dropdown Menu */}
                    {showMenu && (
                        <>
                            {/* Backdrop - z-[65] to be above parent z-[60] */}
                            <div
                                className="fixed inset-0 z-[65]"
                                onClick={() => setShowMenu(false)}
                            />
                            {/* Menu - z-[70] to be above backdrop */}
                            <div className="absolute right-0 top-full mt-1 w-48 bg-slate-800 rounded-xl shadow-xl border border-white/10 py-1 z-[70] animate-in fade-in slide-in-from-top-2 duration-150">
                                <button
                                    onClick={handleResolve}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-slate-700 active:bg-slate-600"
                                >
                                    <CheckCircle2 size={18} className="text-emerald-400" />
                                    <span>Mark Resolved</span>
                                </button>
                                <button
                                    onClick={handleBlock}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-red-400 hover:bg-red-500/20 active:bg-red-500/30"
                                >
                                    <Ban size={18} />
                                    <span>Block Contact</span>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </header>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-slate-900">
                {messages.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-400">No messages yet</p>
                    </div>
                ) : (
                    groupMessagesByDate(messages).map((group, gi) => (
                        <div key={gi}>
                            {/* Date separator */}
                            <div className="flex items-center justify-center my-4">
                                <span className="px-3 py-1 bg-slate-700/80 text-slate-300 text-xs font-medium rounded-full">
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
                                            : 'bg-slate-800/80 backdrop-blur-sm border border-white/10 text-white rounded-bl-md shadow-sm'
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
                                        <p className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-indigo-200' : 'text-slate-400'
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
                className="flex-shrink-0 bg-slate-800/90 backdrop-blur-sm border-t border-white/10"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                {/* Canned Responses Dropdown */}
                {showCanned && (
                    <div className="border-b border-white/10 bg-slate-700/50 max-h-48 overflow-y-auto">
                        <div className="px-3 py-2 text-xs text-slate-400 border-b border-white/10 bg-slate-800 sticky top-0">
                            Type to filter • {filteredCanned.length} response{filteredCanned.length !== 1 ? 's' : ''}
                        </div>
                        {filteredCanned.length > 0 ? (
                            filteredCanned.map(r => (
                                <button
                                    key={r.id}
                                    onClick={() => handleSelectCanned(r)}
                                    className="w-full text-left px-4 py-3 hover:bg-slate-600/50 active:bg-slate-600 border-b border-white/5 last:border-0"
                                >
                                    <span className="text-xs font-mono bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded">
                                        /{r.shortcut}
                                    </span>
                                    <p className="text-sm text-slate-300 mt-1 line-clamp-2">{r.content}</p>
                                </button>
                            ))
                        ) : (
                            <div className="px-4 py-6 text-center text-slate-400 text-sm">
                                {cannedResponses.length === 0 ? 'No canned responses yet' : 'No matches found'}
                            </div>
                        )}
                    </div>
                )}

                {/* Hidden File Input */}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                />

                {/* Toolbar */}
                <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10">
                    <button
                        onClick={handleGenerateAIDraft}
                        disabled={isGeneratingDraft || messages.length === 0}
                        className="p-2 rounded-full hover:bg-purple-500/20 active:bg-purple-500/30 transition-colors disabled:opacity-40"
                        title="Generate AI Draft"
                    >
                        {isGeneratingDraft ? (
                            <Loader2 size={20} className="text-purple-400 animate-spin" />
                        ) : (
                            <Sparkles size={20} className="text-purple-400" />
                        )}
                    </button>
                    <button
                        onClick={() => handleInputChange('/')}
                        className="p-2 rounded-full hover:bg-amber-500/20 active:bg-amber-500/30 transition-colors"
                        title="Canned Responses"
                    >
                        <Zap size={20} className="text-amber-400" />
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="p-2 rounded-full hover:bg-slate-600 active:bg-slate-500 transition-colors disabled:opacity-40"
                        title="Attach File"
                    >
                        {isUploading ? (
                            <Loader2 size={20} className="text-slate-400 animate-spin" />
                        ) : (
                            <Paperclip size={20} className="text-slate-400" />
                        )}
                    </button>
                </div>

                {/* Input Area */}
                <div className="flex items-end gap-2 p-3">
                    <div className="flex-1 bg-slate-700/50 rounded-2xl px-4 py-2">
                        <textarea
                            ref={inputRef}
                            value={newMessage}
                            onChange={(e) => {
                                handleInputChange(e.target.value);
                                // Auto-expand textarea based on content
                                e.target.style.height = 'auto';
                                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
                            }}
                            onKeyDown={handleKeyPress}
                            placeholder="Type a message... (/ for templates)"
                            rows={1}
                            className="w-full bg-transparent resize-none focus:outline-none text-base max-h-32 text-white placeholder-slate-400 overflow-y-auto"
                            style={{ minHeight: '24px', height: 'auto' }}
                        />
                    </div>
                    <button
                        onClick={handleSend}
                        disabled={!newMessage.trim() || sending || showCanned}
                        className={`p-3 rounded-full flex-shrink-0 transition-all ${newMessage.trim() && !sending && !showCanned
                            ? 'bg-indigo-600 text-white active:scale-95'
                            : 'bg-slate-700 text-slate-400'
                            }`}
                    >
                        {sending ? (
                            <Loader2 size={20} className="animate-spin" />
                        ) : (
                            <Send size={20} />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
