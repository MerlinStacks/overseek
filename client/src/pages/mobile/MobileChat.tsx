import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Paperclip, MoreVertical, CheckCircle2, Ban, Mail, MessageSquare, Camera as Instagram, MessageCircle as Facebook, Music2, Sparkles, Loader2, Zap, Maximize2, Minimize2, UserRound } from 'lucide-react';
import DOMPurify from 'dompurify';
import { useMobileChat, type MobileChatMessage } from './useMobileChat';
import { htmlToPreviewText } from '../../utils/messagePreview';
import { useVisualViewport } from '../../hooks/useVisualViewport';
import { MobileReplyEditor } from '../../components/chat/MobileReplyEditor';
import { MobileSavedRepliesSheet } from '../../components/chat/MobileSavedRepliesSheet';
import { MobileAttachmentPreview } from '../../components/chat/MobileAttachmentPreview';
import { MobileCustomerSheet } from '../../components/chat/MobileCustomerSheet';

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
    const viewport = useVisualViewport();
    const [expanded, setExpanded] = useState(false);
    const [showCustomer, setShowCustomer] = useState(false);
    const editorRegionRef = useRef<HTMLDivElement>(null);

    const {
        conversation,
        messages,
        newMessage,
        loading,
        sending,
        showMenu,
        setShowMenu,
        isUploading,
        pendingAttachment,
        attachmentUploadProgress,
        isRichText,
        isGeneratingDraft,
        sendError,
        messagesEndRef,
        messagesContainerRef,
        inputRef,
        fileInputRef,
        cannedResponses,
        cannedLoading,
        cannedError,
        refetchCanned,
        showCanned,
        handleSend,
        handleResolve,
        handleBlock,
        handleFileUpload,
        handleSendAttachment,
        handleRemoveAttachment,
        handleGenerateAIDraft,
        handleInputChange,
        handleSelectCanned,
        handleToggleCanned,
        handleCloseCanned,
        handleKeyPress,
    } = useMobileChat(id);

    useEffect(() => {
        setExpanded(false);
        setShowCustomer(false);
    }, [id]);

    const toggleExpanded = () => {
        setExpanded(value => !value);
        editorRegionRef.current?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')?.focus();
    };
    const canSend = Boolean((isRichText ? htmlToPreviewText(newMessage) : newMessage).trim()) && !sending && !isUploading && !showCanned;

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
            style={{ ...viewport, paddingTop: 'env(safe-area-inset-top)' }}
        >
            <header className={`relative z-10 flex flex-shrink-0 items-center gap-3 border-b border-white/10 bg-slate-950/95 px-4 shadow-xl shadow-black/20 backdrop-blur-xl ${expanded ? 'py-2' : 'py-3'}`}>
                <button
                    onClick={() => expanded ? toggleExpanded() : navigate('/m/inbox')}
                    className="-ml-1 rounded-2xl bg-white/10 p-3 text-white active:scale-95"
                    aria-label={expanded ? 'Return to conversation' : 'Back to inbox'}
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="min-w-0 flex-1">
                    <p className="mb-1 text-[11px] font-bold text-violet-200">{expanded ? 'Writing reply' : 'Conversation'}</p>
                    <h1 className="truncate text-lg font-black text-white">{conversation?.customerName}</h1>
                    <div className={`${expanded ? 'hidden' : 'inline-flex'} mt-1 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${channelConfig.bg} ${channelConfig.color} ring-1 ${channelConfig.ring}`}>
                        <ChannelIcon size={12} />
                        {channelConfig.label}
                    </div>
                </div>
                <button
                    type="button"
                    aria-label="Customer details and recent orders"
                    onClick={() => { setShowMenu(false); setShowCustomer(true); }}
                    className="rounded-2xl bg-white/10 p-3 text-slate-200 active:scale-95"
                ><UserRound size={20} /></button>
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
            <div ref={messagesContainerRef} className={`${expanded ? 'hidden' : ''} min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-950 p-4`}>
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
                                        className={`max-w-[82%] rounded-3xl px-4 py-3 shadow-lg shadow-black/10 ${msg.deliveryStatus === 'FAILED'
                                            ? 'rounded-br-lg border border-rose-400/40 bg-rose-500/20 text-rose-50'
                                            : msg.direction === 'outbound'
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
                                        {msg.deliveryStatus === 'FAILED' && (
                                            <p role="alert" className="mt-2 text-xs font-bold text-rose-200">
                                                {msg.deliveryError || 'Delivery failed. Retry from the composer.'}
                                            </p>
                                        )}
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
                className={`mobile-chat-composer flex flex-col overflow-y-auto overscroll-contain border-t border-white/10 bg-slate-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl ${expanded ? 'is-expanded min-h-0 flex-1' : 'max-h-[65%] flex-shrink-0'}`}
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                />

                {sendError && (
                    <div role="alert" className="border-b border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100">
                        {sendError}. Retry to send again.
                    </div>
                )}

                {pendingAttachment && <MobileAttachmentPreview
                    file={pendingAttachment}
                    uploading={isUploading}
                    progress={attachmentUploadProgress}
                    onRemove={handleRemoveAttachment}
                    onSend={handleSendAttachment}
                    sendingMessage={sending}
                />}

                <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1">
                    <button
                        onClick={handleGenerateAIDraft}
                        disabled={isGeneratingDraft || messages.length === 0}
                        className="rounded-2xl bg-violet-400/15 p-2.5 text-violet-100 ring-1 ring-violet-300/20 transition-colors disabled:opacity-40 active:scale-95"
                        title="Generate AI Draft"
                        aria-label="Generate AI draft"
                    >
                        {isGeneratingDraft ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Sparkles size={18} />
                        )}
                    </button>
                    <button
                        onClick={handleToggleCanned}
                        className="rounded-2xl bg-amber-400/15 p-2.5 text-amber-100 ring-1 ring-amber-300/20 transition-colors active:scale-95"
                        title="Canned Responses"
                        aria-label="Saved replies"
                        aria-expanded={showCanned}
                    >
                        <Zap size={18} />
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading || sending}
                        className="rounded-2xl bg-white/[0.06] p-2.5 text-slate-300 ring-1 ring-white/10 transition-colors disabled:opacity-40 active:scale-95"
                        title="Attach File"
                        aria-label="Choose attachment"
                    >
                        {isUploading ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Paperclip size={18} />
                        )}
                    </button>
                    <button type="button" onClick={toggleExpanded} aria-label={expanded ? 'Collapse reply editor' : 'Expand reply editor'} aria-expanded={expanded} className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 active:bg-white/10">
                        {expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                    </button>
                </div>

                <div className={`mobile-chat-writing-area flex gap-2 p-3 ${expanded ? 'min-h-[200px] flex-1 flex-col' : 'items-end'}`}>
                    <div ref={editorRegionRef} className={`min-w-0 flex-1 rounded-3xl border border-white/10 bg-slate-900 px-4 py-2 shadow-inner shadow-black/20 ${expanded ? 'flex min-h-0 flex-col' : ''}`}>
                        <MobileReplyEditor
                            inputRef={inputRef}
                            value={newMessage}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyPress}
                            richText={isRichText}
                            expanded={expanded}
                        />
                    </div>
                    <button
                        onClick={handleSend}
                        aria-label={sending ? 'Sending reply' : 'Send reply'}
                        disabled={!canSend}
                        className={`flex flex-shrink-0 items-center justify-center gap-2 rounded-2xl p-3 transition-all ${canSend
                            ? 'bg-white text-slate-950 active:scale-95'
                            : 'bg-white/[0.06] text-slate-500 ring-1 ring-white/10'
                            }`}
                    >
                        {sending ? (
                            <Loader2 size={20} className="animate-spin" />
                        ) : (
                            <Send size={20} />
                        )}
                        {expanded && <span className="font-semibold">{sending ? 'Sending…' : 'Send reply'}</span>}
                    </button>
                </div>
            </div>
            {showCanned && <MobileSavedRepliesSheet responses={cannedResponses} loading={cannedLoading} error={cannedError} onRetry={refetchCanned} onSelect={handleSelectCanned} onClose={handleCloseCanned} />}
            <MobileCustomerSheet open={showCustomer} onClose={() => setShowCustomer(false)} conversation={conversation} />
        </div>
    );
}
