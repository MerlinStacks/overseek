
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Send, Loader2, Zap, Paperclip, Settings, FileSignature, Sparkles, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useSocket } from '../../context/SocketContext';
import { CannedResponsesManager } from './CannedResponsesManager';
import { InboxRichTextEditor } from './InboxRichTextEditor';
import { useDrafts } from '../../hooks/useDrafts';
import { SnoozeModal } from './SnoozeModal';
import { AssignModal } from './AssignModal';
import { MergeModal } from './MergeModal';
import { MessageBubble } from './MessageBubble';
import { ImageLightbox } from './ImageLightbox';
import { TypingIndicator } from './TypingIndicator';
import { ChatHeader } from './ChatHeader';
import { ChatSearchBar } from './ChatSearchBar';

interface Message {
    id: string;
    content: string;
    senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
    createdAt: string;
    isInternal: boolean;
    senderId?: string;
    readAt?: string | null;
    status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
    reactions?: Record<string, Array<{ userId: string; userName: string | null }>>;
}

interface CannedResponse {
    id: string;
    shortcut: string;
    content: string;
}

interface ChatWindowProps {
    conversationId: string;
    messages: Message[];
    onSendMessage: (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean) => Promise<void>;
    recipientEmail?: string;
    recipientName?: string;
    status?: string;
    onStatusChange?: (newStatus: string, snoozeUntil?: Date) => Promise<void>;
    onAssign?: (userId: string) => Promise<void>;
    onMerge?: (targetConversationId: string) => Promise<void>;
    onBlock?: () => Promise<void>;
    assigneeId?: string;
}

export function ChatWindow({ conversationId, messages, onSendMessage, recipientEmail, recipientName, status, onStatusChange, onAssign, onMerge, onBlock, assigneeId }: ChatWindowProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [input, setInput] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

    // Modal states
    const [showSnoozeModal, setShowSnoozeModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [showMergeModal, setShowMergeModal] = useState(false);

    // Canned Responses
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const { socket } = useSocket();
    const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
    const [showCanned, setShowCanned] = useState(false);
    const [cannedFilter, setCannedFilter] = useState('');
    const [showCannedManager, setShowCannedManager] = useState(false);

    // Email Signature toggle - default to enabled if user has a signature
    const [signatureEnabled, setSignatureEnabled] = useState(true);

    // AI Draft generation state
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

    // === NEW FEATURE STATES ===

    // Message Search
    const [showSearch, setShowSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Image Lightbox
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    // Quote Reply
    const [quotedMessage, setQuotedMessage] = useState<{ id: string; content: string; senderType: string } | null>(null);

    // Typing Indicator
    const [isCustomerTyping, setIsCustomerTyping] = useState(false);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastTypingEmitRef = useRef<number>(0);

    // Undo Send
    const [pendingSend, setPendingSend] = useState<{ content: string; timeout: NodeJS.Timeout } | null>(null);
    const UNDO_DELAY_MS = 5000;

    // Drafts management
    const { getDraft, saveDraft, clearDraft } = useDrafts();

    // Load draft when conversation changes
    useEffect(() => {
        if (conversationId) {
            const savedDraft = getDraft(conversationId);
            setInput(savedDraft);
            // Reset search when changing conversations
            setShowSearch(false);
            setSearchQuery('');
            setQuotedMessage(null);
            // Cancel any pending send
            if (pendingSend) {
                clearTimeout(pendingSend.timeout);
                setPendingSend(null);
            }
        }
    }, [conversationId, getDraft]);

    // Auto-save draft on input change
    useEffect(() => {
        if (conversationId && input) {
            saveDraft(conversationId, input);
        }
    }, [input, conversationId, saveDraft]);

    // Fetch canned responses
    useEffect(() => {
        if (!currentAccount || !token) return;

        const fetchCanned = async () => {
            try {
                const res = await fetch('/api/chat/canned-responses', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setCannedResponses(data);
                }
            } catch (e) {
                // Silently fail
            }
        };
        fetchCanned();
    }, [currentAccount, token]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, conversationId]);

    // Check for '/' trigger - extract plain text from HTML for detection
    useEffect(() => {
        // Strip HTML tags to get plain text
        const plainText = input.replace(/<[^>]*>/g, '').trim();
        if (plainText.startsWith('/')) {
            setShowCanned(true);
            setCannedFilter(plainText.slice(1).toLowerCase());
        } else {
            setShowCanned(false);
            setCannedFilter('');
        }
    }, [input]);

    // === TYPING INDICATOR LOGIC ===

    // Listen for customer typing events
    useEffect(() => {
        if (!socket || !conversationId) return;

        const handleTypingStart = (data: { conversationId: string }) => {
            if (data.conversationId === conversationId) {
                setIsCustomerTyping(true);
                // Auto-clear after 3 seconds if no stop event
                if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                }
                typingTimeoutRef.current = setTimeout(() => {
                    setIsCustomerTyping(false);
                }, 3000);
            }
        };

        const handleTypingStop = (data: { conversationId: string }) => {
            if (data.conversationId === conversationId) {
                setIsCustomerTyping(false);
                if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                }
            }
        };

        socket.on('typing:start', handleTypingStart);
        socket.on('typing:stop', handleTypingStop);

        return () => {
            socket.off('typing:start', handleTypingStart);
            socket.off('typing:stop', handleTypingStop);
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
        };
    }, [socket, conversationId]);

    // Emit typing events when composing (debounced)
    const emitTyping = useCallback(() => {
        if (!socket || !conversationId) return;

        const now = Date.now();
        // Only emit every 500ms to avoid flooding
        if (now - lastTypingEmitRef.current > 500) {
            socket.emit('typing:start', { conversationId });
            lastTypingEmitRef.current = now;
        }
    }, [socket, conversationId]);

    // Call emitTyping when input changes
    useEffect(() => {
        if (input) {
            emitTyping();
        } else if (socket && conversationId) {
            socket.emit('typing:stop', { conversationId });
        }
    }, [input, emitTyping, socket, conversationId]);

    // === FILTERED MESSAGES FOR SEARCH ===
    const filteredMessages = useMemo(() => {
        if (!searchQuery.trim()) return messages;
        const query = searchQuery.toLowerCase();
        return messages.filter(msg =>
            msg.content.toLowerCase().includes(query)
        );
    }, [messages, searchQuery]);

    const filteredCanned = cannedResponses.filter(r =>
        r.shortcut.toLowerCase().includes(cannedFilter) ||
        r.content.toLowerCase().includes(cannedFilter)
    );

    const handleSelectCanned = (response: CannedResponse) => {
        setInput(response.content);
        setShowCanned(false);
        // Focus handled by ReactQuill editor
    };

    // === UNDO SEND LOGIC ===
    const cancelPendingSend = useCallback(() => {
        if (pendingSend) {
            clearTimeout(pendingSend.timeout);
            setInput(pendingSend.content);
            setPendingSend(null);
        }
    }, [pendingSend]);

    // === REACTION TOGGLE HANDLER ===
    const handleReactionToggle = useCallback(async (messageId: string, emoji: string) => {
        if (!token || !currentAccount) return;

        try {
            const res = await fetch(`/api/chat/messages/${messageId}/reactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ emoji })
            });

            if (!res.ok) {
                console.error('Failed to toggle reaction');
            }
            // Note: Parent component should refresh messages to get updated reactions
            // Or implement optimistic update here
        } catch (error) {
            console.error('Reaction toggle error:', error);
        }
    }, [token, currentAccount]);

    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        // Strip HTML to check for actual content
        const plainText = input.replace(/<[^>]*>/g, '').trim();
        if (!plainText || isSending || pendingSend) return;

        // Prepare message content
        let messageContent = input;

        // Prepend quoted message if present
        if (quotedMessage) {
            const quotedText = quotedMessage.content.replace(/<[^>]*>/g, '').substring(0, 100);
            messageContent = `<blockquote style="border-left: 2px solid #ccc; margin: 0 0 10px 0; padding-left: 10px; color: #666;">${quotedText}${quotedText.length >= 100 ? '...' : ''}</blockquote>${messageContent}`;
        }

        // Append email signature for email replies (not internal notes, not live chat)
        const shouldAppendSignature = signatureEnabled &&
            user?.emailSignature &&
            !isInternal &&
            recipientEmail; // recipientEmail indicates this is an email conversation

        const finalContent = shouldAppendSignature
            ? `${messageContent}\n\n---\n${user!.emailSignature}`
            : messageContent;

        // Store content and start undo timer
        const timeout = setTimeout(async () => {
            setIsSending(true);
            try {
                await onSendMessage(finalContent, 'AGENT', isInternal);
                clearDraft(conversationId);
            } finally {
                setIsSending(false);
                setPendingSend(null);
            }
        }, UNDO_DELAY_MS);

        setPendingSend({ content: input, timeout });
        setInput('');
        setQuotedMessage(null);

        // Emit typing stop
        if (socket && conversationId) {
            socket.emit('typing:stop', { conversationId });
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !token || !currentAccount) return;

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch(`/api/chat/${conversationId}/attachment`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: formData
            });

            if (!res.ok) {
                const error = await res.text();
                alert('Failed to upload: ' + error);
            }
            // Message will appear via socket
        } catch (error) {
            console.error('Upload failed:', error);
            alert('Upload failed');
        } finally {
            setIsUploading(false);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    /**
     * Generates an AI draft reply based on conversation context.
     * Calls the backend endpoint which gathers history, customer info, and policies.
     */
    const handleGenerateAIDraft = async () => {
        if (!token || !currentAccount || isGeneratingDraft) return;

        setIsGeneratingDraft(true);
        try {
            const res = await fetch(`/api/chat/${conversationId}/ai-draft`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                    'Content-Type': 'application/json'
                }
            });

            if (!res.ok) {
                const error = await res.json();
                alert(error.error || 'Failed to generate AI draft');
                return;
            }

            const data = await res.json();
            if (data.draft) {
                setInput(data.draft);
            }
        } catch (error) {
            console.error('AI draft generation failed:', error);
            alert('Failed to generate AI draft. Please try again.');
        } finally {
            setIsGeneratingDraft(false);
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        if (!onStatusChange || isUpdatingStatus) return;
        setIsUpdatingStatus(true);
        try {
            await onStatusChange(newStatus);
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    const isOpen = status === 'OPEN';

    return (
        <div className="flex flex-col h-full bg-white relative">
            {/* Header Bar with Actions */}
            <ChatHeader
                recipientName={recipientName}
                recipientEmail={recipientEmail}
                status={status}
                isUpdatingStatus={isUpdatingStatus}
                showSearch={showSearch}
                onToggleSearch={() => setShowSearch(!showSearch)}
                onStatusChange={handleStatusChange}
                onShowSnooze={() => setShowSnoozeModal(true)}
                onShowAssign={() => setShowAssignModal(true)}
                onShowMerge={() => setShowMergeModal(true)}
                onBlock={onBlock}
            />

            {/* Search Bar */}
            {showSearch && (
                <ChatSearchBar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onClose={() => {
                        setShowSearch(false);
                        setSearchQuery('');
                    }}
                    matchCount={filteredMessages.length}
                    totalCount={messages.length}
                />
            )}

            {/* Messages Area - Using MessageBubble Component */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-100">
                {filteredMessages.map((msg) => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        recipientName={recipientName}
                        onImageClick={(src) => setLightboxImage(src)}
                        onQuoteReply={(msg) => setQuotedMessage(msg)}
                        onReactionToggle={handleReactionToggle}
                    />
                ))}

                {/* Typing Indicator */}
                {isCustomerTyping && (
                    <TypingIndicator name={recipientName} />
                )}

                <div ref={bottomRef} />
            </div>

            {/* Undo Send Toast */}
            {pendingSend && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 z-30">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Sending in {Math.ceil(UNDO_DELAY_MS / 1000)}s...</span>
                    <button
                        onClick={cancelPendingSend}
                        className="text-sm font-medium text-blue-400 hover:text-blue-300"
                    >
                        Undo
                    </button>
                </div>
            )}

            {/* Reply Composer - Chatwoot Style */}
            <div className="border-t border-gray-200 bg-white">
                {/* Canned Responses Dropdown */}
                {showCanned && (
                    <div className="border-b border-gray-200 bg-white max-h-48 overflow-y-auto">
                        <div className="p-2 text-xs text-gray-500 border-b bg-gray-50 flex items-center justify-between">
                            <span>Canned Responses (type to filter)</span>
                            <button
                                onClick={() => {
                                    setShowCannedManager(true);
                                    setShowCanned(false);
                                    setInput('');
                                }}
                                className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                            >
                                <Settings size={12} />
                                Manage
                            </button>
                        </div>
                        {filteredCanned.length > 0 ? (
                            filteredCanned.map(r => (
                                <button
                                    key={r.id}
                                    onClick={() => handleSelectCanned(r)}
                                    className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                                >
                                    <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded-sm text-gray-600">
                                        /{r.shortcut}
                                    </span>
                                    <p className="text-sm text-gray-700 mt-1 line-clamp-1">{r.content}</p>
                                </button>
                            ))
                        ) : (
                            <div className="px-3 py-4 text-center text-gray-500 text-sm">
                                {cannedResponses.length === 0 ? (
                                    <>No canned responses yet. <button onClick={() => setShowCannedManager(true)} className="text-blue-600 hover:underline">Add one</button></>
                                ) : (
                                    'No matches found'
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Reply Mode Toggle */}
                <div className="flex border-b border-gray-100">
                    <button
                        onClick={() => setIsInternal(false)}
                        className={cn(
                            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                            !isInternal
                                ? "border-blue-600 text-blue-600"
                                : "border-transparent text-gray-500 hover:text-gray-700"
                        )}
                    >
                        Reply
                    </button>
                    <button
                        onClick={() => setIsInternal(true)}
                        className={cn(
                            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                            isInternal
                                ? "border-yellow-500 text-yellow-600"
                                : "border-transparent text-gray-500 hover:text-gray-700"
                        )}
                    >
                        Private Note
                    </button>
                </div>

                {/* Quote Reply Preview */}
                {quotedMessage && (
                    <div className="px-4 py-2 border-b border-gray-100 bg-blue-50 flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-xs text-blue-600 font-medium mb-0.5">
                                Replying to {quotedMessage.senderType === 'AGENT' ? 'yourself' : (recipientName || 'customer')}
                            </div>
                            <div className="text-sm text-gray-600 truncate">
                                {quotedMessage.content.replace(/<[^>]*>/g, '').substring(0, 80)}
                                {quotedMessage.content.length > 80 ? '...' : ''}
                            </div>
                        </div>
                        <button
                            onClick={() => setQuotedMessage(null)}
                            className="p-1 rounded-sm hover:bg-blue-100 text-blue-400"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* To/CC Fields (for email replies) */}
                {!isInternal && recipientEmail && (
                    <div className="px-4 py-2 border-b border-gray-100 text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400 w-8">TO</span>
                            <span className="text-gray-700">{recipientEmail}</span>
                        </div>
                    </div>
                )}

                {/* Compose Area */}
                <div className={cn(
                    "p-4",
                    isInternal && "bg-yellow-50"
                )}>
                    <InboxRichTextEditor
                        value={input}
                        onChange={(val) => setInput(val)}
                        onSubmit={() => {
                            if (!showCanned) {
                                handleSend();
                            } else if (filteredCanned.length > 0) {
                                handleSelectCanned(filteredCanned[0]);
                            }
                        }}
                        placeholder={isInternal
                            ? "Add a private note (only visible to team)..."
                            : "Type your reply... (/ for canned responses)"}
                        isInternal={isInternal}
                        cannedPickerOpen={showCanned}
                    />

                    {/* Toolbar */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-1">
                            {/* AI Draft Button */}
                            <button
                                type="button"
                                onClick={handleGenerateAIDraft}
                                disabled={isGeneratingDraft}
                                className="p-2 rounded-sm hover:bg-purple-50 text-purple-500 hover:text-purple-600 transition-colors disabled:opacity-50"
                                title="Generate AI Draft Reply"
                                aria-label="Generate AI draft reply"
                            >
                                {isGeneratingDraft ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                            </button>
                            <button
                                type="button"
                                onClick={() => setInput('/')}
                                className="p-2 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Canned Responses"
                                aria-label="Insert canned response"
                            >
                                <Zap size={18} />
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                                className="hidden"
                                accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading}
                                className="p-2 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                                title="Attach File"
                                aria-label="Attach file"
                            >
                                {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
                            </button>
                            {/* Email Signature Toggle - only show for email conversations */}
                            {recipientEmail && (
                                <button
                                    type="button"
                                    onClick={() => setSignatureEnabled(!signatureEnabled)}
                                    className={cn(
                                        "p-2 rounded-sm transition-colors",
                                        signatureEnabled && user?.emailSignature
                                            ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
                                            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600",
                                        !user?.emailSignature && "opacity-50 cursor-not-allowed"
                                    )}
                                    title={!user?.emailSignature
                                        ? "No signature configured - set one in your profile"
                                        : signatureEnabled
                                            ? "Signature enabled (click to disable)"
                                            : "Enable email signature"
                                    }
                                    disabled={!user?.emailSignature}
                                >
                                    <FileSignature size={18} />
                                </button>
                            )}
                        </div>

                        <button
                            onClick={() => handleSend()}
                            disabled={!input.trim() || isSending || showCanned}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors",
                                isInternal
                                    ? "bg-yellow-500 text-white hover:bg-yellow-600"
                                    : "bg-blue-600 text-white hover:bg-blue-700",
                                "disabled:opacity-50 disabled:cursor-not-allowed"
                            )}
                        >
                            {isSending ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <>
                                    Send
                                    <Send size={14} />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Canned Responses Manager Modal */}
            <CannedResponsesManager
                isOpen={showCannedManager}
                onClose={() => setShowCannedManager(false)}
                onUpdate={() => {
                    // Refetch canned responses
                    if (currentAccount && token) {
                        fetch('/api/chat/canned-responses', {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'x-account-id': currentAccount.id
                            }
                        }).then(res => res.json()).then(data => setCannedResponses(data));
                    }
                }}
            />

            {/* Snooze Modal */}
            <SnoozeModal
                isOpen={showSnoozeModal}
                onClose={() => setShowSnoozeModal(false)}
                onSnooze={async (snoozeUntil) => {
                    if (onStatusChange) {
                        await onStatusChange('SNOOZED', snoozeUntil);
                    }
                }}
            />

            {/* Assign Modal */}
            <AssignModal
                isOpen={showAssignModal}
                onClose={() => setShowAssignModal(false)}
                onAssign={async (userId) => {
                    if (onAssign) {
                        await onAssign(userId);
                    }
                }}
                currentAssigneeId={assigneeId}
            />

            {/* Merge Modal */}
            <MergeModal
                isOpen={showMergeModal}
                onClose={() => setShowMergeModal(false)}
                onMerge={async (targetId) => {
                    if (onMerge) {
                        await onMerge(targetId);
                    }
                }}
                currentConversationId={conversationId}
            />

            {/* Image Lightbox */}
            {lightboxImage && (
                <ImageLightbox
                    src={lightboxImage}
                    onClose={() => setLightboxImage(null)}
                />
            )}
        </div>
    );
}
