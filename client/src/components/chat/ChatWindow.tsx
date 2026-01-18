/**
 * ChatWindow - Orchestration component for chat conversations.
 * Delegates compose, typing, and send logic to extracted hooks and components.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

// Extracted hooks
import { useCannedResponses } from '../../hooks/useCannedResponses';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useMessageSend } from '../../hooks/useMessageSend';
import { useConversationPresence } from '../../hooks/useConversationPresence';

// Sub-components
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { ChatHeader } from './ChatHeader';
import { ChatSearchBar } from './ChatSearchBar';
import { ChatComposer } from './ChatComposer';
import { ChatModals } from './ChatModals';
import { ConversationChannel } from './ChannelSelector';

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

interface ChannelOption {
    channel: ConversationChannel;
    identifier: string;
    available: boolean;
}

import type { MergedRecipient } from './RecipientList';

interface CustomerData {
    firstName?: string;
    lastName?: string;
    email?: string;
    ordersCount?: number;
    totalSpent?: number;
    wooId?: number;
}

interface ChatWindowProps {
    conversationId: string;
    messages: Message[];
    onSendMessage: (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean, channel?: ConversationChannel, emailAccountId?: string) => Promise<void>;
    recipientEmail?: string;
    recipientName?: string;
    status?: string;
    onStatusChange?: (newStatus: string, snoozeUntil?: Date) => Promise<void>;
    onAssign?: (userId: string) => Promise<void>;
    onMerge?: (targetConversationId: string) => Promise<void>;
    onBlock?: () => Promise<void>;
    assigneeId?: string;
    availableChannels?: ChannelOption[];
    currentChannel?: ConversationChannel;
    mergedRecipients?: MergedRecipient[];
    /** Customer data for canned response merge tags */
    customerData?: CustomerData;
}

export function ChatWindow({
    conversationId,
    messages,
    onSendMessage,
    recipientEmail,
    recipientName,
    status,
    onStatusChange,
    onAssign,
    onMerge,
    onBlock,
    assigneeId,
    availableChannels,
    currentChannel,
    mergedRecipients = [],
    customerData
}: ChatWindowProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    // === EMAIL ACCOUNTS STATE ===
    interface EmailAccount {
        id: string;
        name: string;
        email: string;
        isDefault?: boolean;
    }
    const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
    const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string>('');

    // Fetch email accounts for the From dropdown
    useEffect(() => {
        if (!currentAccount || !token) return;
        const fetchEmailAccounts = async () => {
            try {
                const res = await fetch('/api/chat/email-accounts', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const accounts = await res.json();
                    setEmailAccounts(accounts);
                    // Set default selection to first account or the default one
                    if (accounts.length > 0) {
                        const defaultAccount = accounts.find((a: EmailAccount) => a.isDefault) || accounts[0];
                        setSelectedEmailAccountId(defaultAccount.id);
                    }
                }
            } catch (err) {
                Logger.error('Failed to fetch email accounts', { error: err });
            }
        };
        fetchEmailAccounts();
    }, [currentAccount, token]);

    // === STATE FOR ATTACHMENTS (must be before sendMessageWithAttachments callback) ===
    const [stagedAttachments, setStagedAttachments] = useState<File[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    // === EXTRACTED HOOKS ===
    const canned = useCannedResponses();

    // Wrapper for sending messages that includes staged attachments
    // This must be defined before useMessageSend to avoid dependency issues
    const sendMessageWithAttachments = useCallback(async (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean, channel?: ConversationChannel, emailAccId?: string) => {
        // If no staged attachments, use normal send
        if (stagedAttachments.length === 0) {
            return onSendMessage(content, type, isInternal, channel, emailAccId);
        }

        // Upload attachments with message content
        setIsUploading(true);
        setUploadProgress(0);

        try {
            const formData = new FormData();
            formData.append('content', content);
            formData.append('type', type);
            formData.append('isInternal', String(isInternal));
            if (channel) formData.append('channel', channel);
            if (emailAccId) formData.append('emailAccountId', emailAccId);

            stagedAttachments.forEach(file => {
                formData.append('attachments', file);
            });

            const xhr = new XMLHttpRequest();

            await new Promise<void>((resolve, reject) => {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        setUploadProgress(Math.round((event.loaded / event.total) * 100));
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            reject(new Error(data.error || 'Failed to send message with attachments'));
                        } catch {
                            reject(new Error('Failed to send'));
                        }
                    }
                };

                xhr.onerror = () => reject(new Error('Network error'));

                xhr.open('POST', `/api/chat/${conversationId}/message-with-attachments`);
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.setRequestHeader('x-account-id', currentAccount?.id || '');
                xhr.send(formData);
            });

            // Clear staged attachments on success
            setStagedAttachments([]);
            setUploadProgress(0);
        } catch (error) {
            Logger.error('Failed to send message with attachments', { error });
            throw error;
        } finally {
            setIsUploading(false);
        }
    }, [stagedAttachments, onSendMessage, conversationId, token, currentAccount?.id]);

    const messageSend = useMessageSend({
        conversationId,
        onSendMessage: sendMessageWithAttachments, // Uses wrapper that handles attachments
        recipientEmail,
        isLiveChat: currentChannel === 'CHAT',
        emailAccountId: selectedEmailAccountId
    });
    const { isCustomerTyping } = useTypingIndicator({ conversationId, input: messageSend.input });
    const { otherViewers } = useConversationPresence(conversationId);

    // === LOCAL STATE ===
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

    // Modal states
    const [showSnoozeModal, setShowSnoozeModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [showMergeModal, setShowMergeModal] = useState(false);
    const [showScheduleModal, setShowScheduleModal] = useState(false);

    // Search state
    const [showSearch, setShowSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Lightbox state
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    // Reset search when changing conversations
    useEffect(() => {
        setShowSearch(false);
        setSearchQuery('');
    }, [conversationId]);

    // Scroll to bottom on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, conversationId]);

    // Detect '/' trigger for canned responses
    useEffect(() => {
        canned.handleInputForCanned(messageSend.input);
    }, [messageSend.input, canned]);

    // === FILTERED MESSAGES FOR SEARCH ===
    const filteredMessages = useMemo(() => {
        if (!searchQuery.trim()) return messages;
        const query = searchQuery.toLowerCase();
        return messages.filter(msg => msg.content.toLowerCase().includes(query));
    }, [messages, searchQuery]);

    // === REACTION TOGGLE HANDLER ===
    const handleReactionToggle = useCallback(async (messageId: string, emoji: string) => {
        if (!token || !currentAccount) return;
        try {
            await fetch(`/api/chat/messages/${messageId}/reactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ emoji })
            });
        } catch (error) {
            Logger.error('Reaction toggle error:', { error: error });
        }
    }, [token, currentAccount]);

    // === STATUS CHANGE ===
    const handleStatusChange = async (newStatus: string) => {
        if (!onStatusChange || isUpdatingStatus) return;
        setIsUpdatingStatus(true);
        try {
            await onStatusChange(newStatus);
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    // === FILE STAGING (not immediate upload) ===
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        // Stage files locally - they will be uploaded when user sends the message
        setStagedAttachments(prev => [...prev, ...Array.from(files)]);

        // Reset input so same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleRemoveAttachment = (index: number) => {
        setStagedAttachments(prev => prev.filter((_, i) => i !== index));
    };

    // === AI DRAFT GENERATION ===
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
                },
                body: JSON.stringify({ currentDraft: messageSend.input || '' })
            });

            if (!res.ok) {
                const error = await res.json();
                alert(error.error || 'Failed to generate AI draft');
                return;
            }

            const data = await res.json();
            if (data.draft) {
                messageSend.setInput(data.draft);
            }
        } catch (error) {
            Logger.error('AI draft generation failed:', { error: error });
            alert('Failed to generate AI draft. Please try again.');
        } finally {
            setIsGeneratingDraft(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white relative">
            {/* Header Bar with Actions */}
            <ChatHeader
                conversationId={conversationId}
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
                otherViewers={otherViewers}
                mergedRecipients={mergedRecipients}
                primaryChannel={currentChannel}
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

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-100">
                {filteredMessages.map((msg) => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        recipientName={recipientName}
                        recipientEmail={recipientEmail}
                        onImageClick={(src) => setLightboxImage(src)}
                        onQuoteReply={(msg) => messageSend.setQuotedMessage(msg)}
                        onReactionToggle={handleReactionToggle}
                    />
                ))}

                {/* Typing Indicator */}
                {isCustomerTyping && <TypingIndicator name={recipientName} />}

                <div ref={bottomRef} />
            </div>

            {/* Undo Send Toast */}
            {messageSend.pendingSend && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 z-30">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Sending in {Math.ceil(messageSend.UNDO_DELAY_MS / 1000)}s...</span>
                    <button
                        onClick={messageSend.cancelPendingSend}
                        className="text-sm font-medium text-blue-400 hover:text-blue-300"
                    >
                        Undo
                    </button>
                </div>
            )}

            {/* Reply Composer */}
            <ChatComposer
                conversationId={conversationId}
                recipientEmail={recipientEmail}
                recipientName={recipientName}
                input={messageSend.input}
                onInputChange={messageSend.setInput}
                isInternal={messageSend.isInternal}
                onInternalChange={messageSend.setIsInternal}
                isSending={messageSend.isSending}
                onSend={messageSend.handleSend}
                pendingSend={messageSend.pendingSend}
                onCancelSend={messageSend.cancelPendingSend}
                UNDO_DELAY_MS={messageSend.UNDO_DELAY_MS}
                signatureEnabled={messageSend.signatureEnabled}
                onSignatureChange={messageSend.setSignatureEnabled}
                quotedMessage={messageSend.quotedMessage}
                onClearQuote={() => messageSend.setQuotedMessage(null)}
                showCanned={canned.showCanned}
                filteredCanned={canned.filteredCanned}
                cannedResponses={canned.cannedResponses}
                onSelectCanned={(r) => {
                    const context = {
                        firstName: customerData?.firstName,
                        lastName: customerData?.lastName,
                        email: customerData?.email || recipientEmail,
                        ordersCount: customerData?.ordersCount,
                        totalSpent: customerData?.totalSpent,
                        wooCustomerId: customerData?.wooId,
                        agentFirstName: user?.fullName?.split(' ')[0],
                        agentFullName: user?.fullName || undefined
                    };
                    messageSend.setInput(canned.selectCanned(r, context));
                }}
                onOpenCannedManager={() => canned.setShowCannedManager(true)}
                isGeneratingDraft={isGeneratingDraft}
                onGenerateAIDraft={handleGenerateAIDraft}
                isUploading={isUploading}
                uploadProgress={uploadProgress}
                onFileUpload={handleFileUpload}
                fileInputRef={fileInputRef}
                stagedAttachments={stagedAttachments}
                onRemoveAttachment={handleRemoveAttachment}
                onOpenSchedule={() => setShowScheduleModal(true)}
                availableChannels={availableChannels}
                currentChannel={currentChannel}
                emailAccounts={emailAccounts}
                selectedEmailAccountId={selectedEmailAccountId}
                onEmailAccountChange={setSelectedEmailAccountId}
            />

            {/* All Modals */}
            <ChatModals
                conversationId={conversationId}
                assigneeId={assigneeId}
                showCannedManager={canned.showCannedManager}
                onCloseCannedManager={() => canned.setShowCannedManager(false)}
                onCannedUpdate={canned.refetchCanned}
                showSnoozeModal={showSnoozeModal}
                onCloseSnooze={() => setShowSnoozeModal(false)}
                onSnooze={async (snoozeUntil) => {
                    if (onStatusChange) {
                        await onStatusChange('SNOOZED', snoozeUntil);
                    }
                }}
                showAssignModal={showAssignModal}
                onCloseAssign={() => setShowAssignModal(false)}
                onAssign={onAssign}
                showMergeModal={showMergeModal}
                onCloseMerge={() => setShowMergeModal(false)}
                onMerge={onMerge}
                lightboxImage={lightboxImage}
                onCloseLightbox={() => setLightboxImage(null)}
                showScheduleModal={showScheduleModal}
                onCloseSchedule={() => setShowScheduleModal(false)}
                onSchedule={messageSend.handleScheduleMessage}
                isScheduling={messageSend.isScheduling}
            />
        </div>
    );
}
