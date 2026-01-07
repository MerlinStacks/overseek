
import { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Zap, Paperclip, MoreHorizontal, ChevronDown, Clock, CheckCircle, RotateCcw, MoreVertical, Settings, FileSignature, Sparkles, Users, Merge } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { format } from 'date-fns';
import { CannedResponsesManager } from './CannedResponsesManager';
import { InboxRichTextEditor } from './InboxRichTextEditor';
import { useDrafts } from '../../hooks/useDrafts';
import { SnoozeModal } from './SnoozeModal';
import { AssignModal } from './AssignModal';
import { MergeModal } from './MergeModal';

interface Message {
    id: string;
    content: string;
    senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
    createdAt: string;
    isInternal: boolean;
    senderId?: string;
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
    assigneeId?: string;
}

export function ChatWindow({ conversationId, messages, onSendMessage, recipientEmail, recipientName, status, onStatusChange, onAssign, onMerge, assigneeId }: ChatWindowProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [input, setInput] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [showActionsMenu, setShowActionsMenu] = useState(false);

    // Modal states
    const [showSnoozeModal, setShowSnoozeModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [showMergeModal, setShowMergeModal] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);

    // Canned Responses
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
    const [showCanned, setShowCanned] = useState(false);
    const [cannedFilter, setCannedFilter] = useState('');
    const [showCannedManager, setShowCannedManager] = useState(false);

    // Email Signature toggle - default to enabled if user has a signature
    const [signatureEnabled, setSignatureEnabled] = useState(true);

    // AI Draft generation state
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

    // Drafts management
    const { getDraft, saveDraft, clearDraft } = useDrafts();

    // Load draft when conversation changes
    useEffect(() => {
        if (conversationId) {
            const savedDraft = getDraft(conversationId);
            setInput(savedDraft);
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

    const filteredCanned = cannedResponses.filter(r =>
        r.shortcut.toLowerCase().includes(cannedFilter) ||
        r.content.toLowerCase().includes(cannedFilter)
    );

    const handleSelectCanned = (response: CannedResponse) => {
        setInput(response.content);
        setShowCanned(false);
        // Focus handled by ReactQuill editor
    };

    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        // Strip HTML to check for actual content
        const plainText = input.replace(/<[^>]*>/g, '').trim();
        if (!plainText || isSending) return;

        setIsSending(true);
        try {
            // Append email signature for email replies (not internal notes, not live chat)
            const shouldAppendSignature = signatureEnabled &&
                user?.emailSignature &&
                !isInternal &&
                recipientEmail; // recipientEmail indicates this is an email conversation

            const messageContent = shouldAppendSignature
                ? `${input}\n\n---\n${user!.emailSignature}`
                : input;

            await onSendMessage(messageContent, 'AGENT', isInternal);
            setInput('');
            // Clear draft after successful send
            clearDraft(conversationId);
        } finally {
            setIsSending(false);
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

    // Parse email content (subject + body)
    const parseEmailContent = (content: string) => {
        if (content.startsWith('Subject:')) {
            const lines = content.split('\n');
            const subjectLine = lines[0].replace('Subject:', '').trim();
            const body = lines.slice(2).join('\n').trim();
            return { subject: subjectLine, body };
        }
        return { subject: null, body: content };
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
            setShowActionsMenu(false);
        }
    };

    const isOpen = status === 'OPEN';

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header Bar with Actions */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
                {/* Left - Sender Info */}
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-medium">
                        {recipientName ? recipientName.charAt(0).toUpperCase() : 'C'}
                    </div>
                    <div className="min-w-0">
                        <div className="font-medium text-gray-900 text-sm truncate">
                            {recipientName || recipientEmail || 'Customer'}
                        </div>
                        {recipientEmail && recipientName && (
                            <div className="text-xs text-gray-500 truncate">{recipientEmail}</div>
                        )}
                    </div>
                </div>

                {/* Right - Actions */}
                <div className="flex items-center gap-2">
                    {/* Resolve/Reopen Button with Dropdown */}
                    <div className="relative">
                        <div className="flex">
                            <button
                                onClick={() => handleStatusChange(isOpen ? 'CLOSED' : 'OPEN')}
                                disabled={isUpdatingStatus}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-sm font-medium transition-colors",
                                    isOpen
                                        ? "bg-green-600 text-white hover:bg-green-700"
                                        : "bg-blue-600 text-white hover:bg-blue-700",
                                    isUpdatingStatus && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {isOpen ? <CheckCircle size={14} /> : <RotateCcw size={14} />}
                                {isUpdatingStatus ? '...' : (isOpen ? 'Resolve' : 'Reopen')}
                            </button>
                            <button
                                onClick={() => setShowActionsMenu(!showActionsMenu)}
                                className={cn(
                                    "px-2 py-1.5 rounded-r-lg border-l transition-colors",
                                    isOpen
                                        ? "bg-green-600 text-white hover:bg-green-700 border-green-700"
                                        : "bg-blue-600 text-white hover:bg-blue-700 border-blue-700"
                                )}
                            >
                                <ChevronDown size={14} />
                            </button>
                        </div>

                        {/* Dropdown Menu */}
                        {showActionsMenu && (
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                                <button
                                    onClick={() => {
                                        setShowActionsMenu(false);
                                        setShowSnoozeModal(true);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                    <Clock size={14} />
                                    Snooze
                                </button>
                                <button
                                    onClick={() => handleStatusChange('PENDING')}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                    <MoreHorizontal size={14} />
                                    Mark as pending
                                </button>
                            </div>
                        )}
                    </div>

                    {/* More Options */}
                    <div className="relative">
                        <button
                            onClick={() => setShowMoreMenu(!showMoreMenu)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                        >
                            <MoreVertical size={16} />
                        </button>

                        {/* More Options Dropdown */}
                        {showMoreMenu && (
                            <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                                <button
                                    onClick={() => {
                                        setShowMoreMenu(false);
                                        setShowAssignModal(true);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors rounded-t-lg"
                                >
                                    <Users size={14} />
                                    Assign to team member
                                </button>
                                <button
                                    onClick={() => {
                                        setShowMoreMenu(false);
                                        setShowMergeModal(true);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors rounded-b-lg"
                                >
                                    <Merge size={14} />
                                    Merge with another conversation
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Messages Area - Chat Bubble Style */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                {messages.map((msg) => {
                    const isMe = msg.senderType === 'AGENT';
                    const isSystem = msg.senderType === 'SYSTEM';
                    const { subject, body } = parseEmailContent(msg.content);

                    if (isSystem) {
                        return (
                            <div key={msg.id} className="flex justify-center">
                                <span className="text-gray-500 text-xs italic bg-white px-3 py-1 rounded-full shadow-sm">
                                    {msg.content}
                                </span>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex gap-2",
                                isMe ? "justify-end" : "justify-start"
                            )}
                        >
                            {/* Customer Avatar - Left side */}
                            {!isMe && (
                                <div className="w-7 h-7 rounded-full bg-gray-400 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                                    {(recipientName?.charAt(0) || 'C').toUpperCase()}
                                </div>
                            )}

                            {/* Message Bubble */}
                            <div
                                className={cn(
                                    "max-w-[70%] rounded-2xl px-3 py-2 shadow-sm",
                                    isMe
                                        ? "bg-blue-600 text-white rounded-br-md"
                                        : "bg-white text-gray-800 rounded-bl-md border border-gray-100",
                                    msg.isInternal && "bg-yellow-100 text-yellow-900 border-yellow-200"
                                )}
                            >
                                {/* Private Note Badge */}
                                {msg.isInternal && (
                                    <div className="text-[10px] font-medium text-yellow-700 mb-1">
                                        🔒 Private Note
                                    </div>
                                )}

                                {/* Subject line for emails */}
                                {subject && (
                                    <div className={cn(
                                        "text-xs font-semibold mb-1",
                                        isMe ? "text-blue-100" : "text-gray-600"
                                    )}>
                                        {subject}
                                    </div>
                                )}

                                {/* Message body */}
                                <div
                                    className="text-sm whitespace-pre-wrap break-words leading-relaxed"
                                    dangerouslySetInnerHTML={{ __html: body }}
                                />

                                {/* Timestamp */}
                                <div className={cn(
                                    "text-[10px] mt-1",
                                    isMe ? "text-blue-200" : "text-gray-400"
                                )}>
                                    {format(new Date(msg.createdAt), 'h:mm a')}
                                </div>
                            </div>

                            {/* Agent Avatar - Right side */}
                            {isMe && (
                                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                                    ME
                                </div>
                            )}
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

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
                                    <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
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
                                className="p-2 rounded hover:bg-purple-50 text-purple-500 hover:text-purple-600 transition-colors disabled:opacity-50"
                                title="Generate AI Draft Reply"
                            >
                                {isGeneratingDraft ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                            </button>
                            <button
                                type="button"
                                onClick={() => setInput('/')}
                                className="p-2 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Canned Responses"
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
                                className="p-2 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                                title="Attach File"
                            >
                                {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
                            </button>
                            {/* Email Signature Toggle - only show for email conversations */}
                            {recipientEmail && (
                                <button
                                    type="button"
                                    onClick={() => setSignatureEnabled(!signatureEnabled)}
                                    className={cn(
                                        "p-2 rounded transition-colors",
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
        </div>
    );
}
