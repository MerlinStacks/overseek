import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Paperclip, MoreVertical, CheckCircle2, Ban, Mail, Instagram, Facebook, Music2, Sparkles, Loader2, Zap } from 'lucide-react';
import DOMPurify from 'dompurify';
import { useMobileChat, type MobileChatMessage } from './useMobileChat';

const CHANNEL_CONFIG: Record<string, { icon: typeof Mail; color: string; bg: string; label: string }> = {
    email: { icon: Mail, color: 'text-blue-600', bg: 'bg-blue-100', label: 'Email' },
    facebook: { icon: Facebook, color: 'text-blue-700', bg: 'bg-blue-100', label: 'Facebook' },
    instagram: { icon: Instagram, color: 'text-pink-600', bg: 'bg-pink-100', label: 'Instagram' },
    tiktok: { icon: Music2, color: 'text-gray-900', bg: 'bg-gray-100', label: 'TikTok' },
};

// -------------------------------------------------------
// Formatting helpers (pure functions, no state needed)
// -------------------------------------------------------

function formatTime(date: string) {
    return new Date(date).toLocaleTimeString('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function formatDate(date: string) {
    const d = new Date(date);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const isYesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();

    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function groupMessagesByDate(msgs: MobileChatMessage[]) {
    const groups: { date: string; messages: MobileChatMessage[] }[] = [];
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
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------

/**
 * MobileChat — presentational shell for the mobile chat view.
 *
 * All state management and data-fetching live in the `useMobileChat` hook.
 * This component only renders UI and handles navigation.
 */
export function MobileChat() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const {
        conversation,
        messages,
        newMessage,
        loading,
        sending,
        showMenu,
        setShowMenu,
        isUploading,
        isGeneratingDraft,
        messagesEndRef,
        inputRef,
        fileInputRef,
        filteredCanned,
        cannedResponses,
        showCanned,
        handleSend,
        handleResolve,
        handleBlock,
        handleFileUpload,
        handleGenerateAIDraft,
        handleInputChange,
        handleSelectCanned,
        handleKeyPress,
    } = useMobileChat(id);

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
                            <div
                                className="fixed inset-0 z-[65]"
                                onClick={() => setShowMenu(false)}
                            />
                            <div className="absolute right-0 top-full mt-1 w-48 bg-slate-800 rounded-xl shadow-xl border border-white/10 py-1 z-[70] animate-in fade-in slide-in-from-top-2 duration-150">
                                <button
                                    onClick={async () => {
                                        const ok = await handleResolve();
                                        if (ok) navigate('/m/inbox');
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-slate-700 active:bg-slate-600"
                                >
                                    <CheckCircle2 size={18} className="text-emerald-400" />
                                    <span>Mark Resolved</span>
                                </button>
                                <button
                                    onClick={async () => {
                                        const ok = await handleBlock();
                                        if (ok) navigate('/m/inbox');
                                    }}
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
                            <div className="flex items-center justify-center my-4">
                                <span className="px-3 py-1 bg-slate-700/80 text-slate-300 text-xs font-medium rounded-full">
                                    {formatDate(group.date)}
                                </span>
                            </div>
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
                                        {/\<[a-z][\s\S]*\>/i.test(msg.body) ? (
                                            <div
                                                className="text-sm [&_a]:text-indigo-300 [&_a]:underline [&_img]:max-w-full [&_img]:rounded"
                                                dangerouslySetInnerHTML={{
                                                    __html: DOMPurify.sanitize(msg.body, {
                                                        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'div', 'span'],
                                                        ALLOWED_ATTR: ['href', 'target', 'rel'],
                                                    }),
                                                }}
                                            />
                                        ) : (
                                            <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                                        )}
                                        <p className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-indigo-200' : 'text-slate-400'}`}>
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
