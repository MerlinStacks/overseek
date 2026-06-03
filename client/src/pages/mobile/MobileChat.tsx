import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Paperclip, MoreVertical, CheckCircle2, Ban, Mail, MessageSquare, Instagram, Facebook, Music2, Sparkles, Loader2, Zap } from 'lucide-react';
import DOMPurify from 'dompurify';
import { useMobileChat, type MobileChatMessage } from './useMobileChat';

const CHANNEL_CONFIG: Record<string, { icon: typeof Mail; color: string; bg: string; ring: string; label: string }> = {
    chat: { icon: MessageSquare, color: 'text-emerald-100', bg: 'bg-emerald-400/15', ring: 'ring-emerald-300/20', label: 'Live Chat' },
    email: { icon: Mail, color: 'text-sky-100', bg: 'bg-sky-400/15', ring: 'ring-sky-300/20', label: 'Email' },
    facebook: { icon: Facebook, color: 'text-blue-100', bg: 'bg-blue-400/15', ring: 'ring-blue-300/20', label: 'Facebook' },
    instagram: { icon: Instagram, color: 'text-pink-100', bg: 'bg-pink-400/15', ring: 'ring-pink-300/20', label: 'Instagram' },
    tiktok: { icon: Music2, color: 'text-slate-100', bg: 'bg-slate-400/15', ring: 'ring-white/10', label: 'TikTok' },
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
        messagesContainerRef,
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
            <div className="fixed inset-0 z-[60] flex flex-col animate-pulse bg-slate-950">
                <div className="h-24 bg-slate-900" />
                <div className="flex-1 p-4 space-y-4">
                    <div className="h-16 w-3/4 rounded-2xl bg-slate-900" />
                    <div className="ml-auto h-12 w-1/2 rounded-2xl bg-slate-900" />
                    <div className="h-20 w-2/3 rounded-2xl bg-slate-900" />
                </div>
                <div className="h-28 bg-slate-900" />
            </div>
        );
    }

    return (
        <div
            className="fixed inset-0 z-[60] flex flex-col bg-slate-950"
            style={{ height: '100dvh', paddingTop: 'env(safe-area-inset-top)' }}
        >
            <header className="relative z-10 flex flex-shrink-0 items-center gap-3 border-b border-white/10 bg-slate-950/95 px-4 py-4 shadow-xl shadow-black/20 backdrop-blur-xl">
                <button
                    onClick={() => navigate('/m/inbox')}
                    className="-ml-1 rounded-2xl bg-white/10 p-3 text-white active:scale-95"
                    aria-label="Back to inbox"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="min-w-0 flex-1">
                    <p className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-violet-400/10 px-2 py-0.5 text-[11px] font-bold text-violet-100 ring-1 ring-violet-300/20">Conversation</p>
                    <h1 className="truncate text-lg font-black text-white">{conversation?.customerName}</h1>
                    <div className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${channelConfig.bg} ${channelConfig.color} ring-1 ${channelConfig.ring}`}>
                        <ChannelIcon size={12} />
                        {channelConfig.label}
                    </div>
                </div>
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="rounded-2xl bg-white/10 p-3 active:scale-95"
                        aria-label="Conversation actions"
                    >
                        <MoreVertical size={18} className="text-slate-200" />
                    </button>
                    {showMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-[65]"
                                onClick={() => setShowMenu(false)}
                            />
                            <div className="absolute right-0 top-full z-[70] mt-2 w-56 rounded-2xl border border-white/10 bg-slate-950 py-1 shadow-2xl shadow-black/40 animate-in fade-in slide-in-from-top-2 duration-150">
                                <button
                                    onClick={async () => {
                                        const ok = await handleResolve();
                                        if (ok) navigate('/m/inbox');
                                    }}
                                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 active:bg-white/10"
                                >
                                    <CheckCircle2 size={18} className="text-emerald-400" />
                                    <span>Mark Resolved</span>
                                </button>
                                <button
                                    onClick={async () => {
                                        const ok = await handleBlock();
                                        if (ok) navigate('/m/inbox');
                                    }}
                                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-red-300 active:bg-red-500/20"
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
            <div ref={messagesContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-950 p-4">
                {messages.length === 0 ? (
                    <div className="rounded-[2rem] border border-white/10 bg-slate-900 px-5 py-14 text-center">
                        <MessageSquare className="mx-auto mb-3 text-slate-600" size={36} />
                        <p className="font-black text-white">No messages yet</p>
                        <p className="mt-1 text-sm text-slate-400">Send the first reply from the composer below.</p>
                    </div>
                ) : (
                    groupMessagesByDate(messages).map((group, gi) => (
                        <div key={gi}>
                            <div className="my-4 flex items-center justify-center">
                                <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-bold text-slate-400 ring-1 ring-white/10">
                                    {formatDate(group.date)}
                                </span>
                            </div>
                            {group.messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`flex mb-2 ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div
                                        className={`max-w-[82%] rounded-3xl px-4 py-3 shadow-lg shadow-black/10 ${msg.direction === 'outbound'
                                            ? 'rounded-br-lg bg-indigo-500 text-white'
                                            : 'rounded-bl-lg border border-white/10 bg-slate-900 text-white'
                                            }`}
                                    >
                                        {/<[a-z][\s\S]*>/i.test(msg.body) ? (
                                            <div
                                                className="text-sm leading-relaxed [&_a]:text-indigo-200 [&_a]:underline [&_img]:max-w-full [&_img]:rounded-xl"
                                                dangerouslySetInnerHTML={{
                                                    __html: DOMPurify.sanitize(msg.body, {
                                                        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'div', 'span'],
                                                        ALLOWED_ATTR: ['href', 'target', 'rel'],
                                                    }),
                                                }}
                                            />
                                        ) : (
                                            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.body}</p>
                                        )}
                                        <p className={`mt-2 text-[11px] font-medium ${msg.direction === 'outbound' ? 'text-indigo-100/80' : 'text-slate-500'}`}>
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
                className="flex-shrink-0 border-t border-white/10 bg-slate-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                {showCanned && (
                    <div className="max-h-48 overflow-y-auto border-b border-white/10 bg-slate-900">
                        <div className="sticky top-0 border-b border-white/10 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-400">
                            Type to filter • {filteredCanned.length} response{filteredCanned.length !== 1 ? 's' : ''}
                        </div>
                        {filteredCanned.length > 0 ? (
                            filteredCanned.map(r => (
                                <button
                                    key={r.id}
                                    onClick={() => handleSelectCanned(r)}
                                    className="w-full border-b border-white/5 px-4 py-3 text-left last:border-0 active:bg-white/10"
                                >
                                    <span className="rounded bg-indigo-400/15 px-1.5 py-0.5 font-mono text-xs text-indigo-100 ring-1 ring-indigo-300/20">
                                        /{r.shortcut}
                                    </span>
                                    <p className="text-sm text-slate-300 mt-1 line-clamp-2">{r.content}</p>
                                </button>
                            ))
                        ) : (
                            <div className="px-4 py-6 text-center text-sm text-slate-400">
                                {cannedResponses.length === 0 ? 'No canned responses yet' : 'No matches found'}
                            </div>
                        )}
                    </div>
                )}

                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                />

                <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                    <button
                        onClick={handleGenerateAIDraft}
                        disabled={isGeneratingDraft || messages.length === 0}
                        className="rounded-2xl bg-violet-400/15 p-2.5 text-violet-100 ring-1 ring-violet-300/20 transition-colors disabled:opacity-40 active:scale-95"
                        title="Generate AI Draft"
                    >
                        {isGeneratingDraft ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Sparkles size={18} />
                        )}
                    </button>
                    <button
                        onClick={() => handleInputChange('/')}
                        className="rounded-2xl bg-amber-400/15 p-2.5 text-amber-100 ring-1 ring-amber-300/20 transition-colors active:scale-95"
                        title="Canned Responses"
                    >
                        <Zap size={18} />
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="rounded-2xl bg-white/[0.06] p-2.5 text-slate-300 ring-1 ring-white/10 transition-colors disabled:opacity-40 active:scale-95"
                        title="Attach File"
                    >
                        {isUploading ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Paperclip size={18} />
                        )}
                    </button>
                </div>

                <div className="flex items-end gap-2 p-3">
                    <div className="flex-1 rounded-3xl border border-white/10 bg-slate-900 px-4 py-2 shadow-inner shadow-black/20">
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
                            className="max-h-32 w-full resize-none overflow-y-auto bg-transparent text-base text-white placeholder-slate-500 focus:outline-none"
                            style={{ minHeight: '24px', height: 'auto' }}
                        />
                    </div>
                    <button
                        onClick={handleSend}
                        disabled={!newMessage.trim() || sending || showCanned}
                        className={`flex-shrink-0 rounded-2xl p-3 transition-all ${newMessage.trim() && !sending && !showCanned
                            ? 'bg-white text-slate-950 active:scale-95'
                            : 'bg-white/[0.06] text-slate-500 ring-1 ring-white/10'
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
