/**
 * ChatWindow - Orchestration component for chat conversations.
 * Delegates compose, typing, and send logic to extracted hooks and components.
 * Memoized to prevent re-renders from parent state changes (e.g. conversation list updates).
 */
import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import DOMPurify from 'dompurify';
import { Logger } from '../../utils/logger';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

// Extracted hooks (canned + email accounts are passed in as props from InboxPage)
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useMessageSend } from '../../hooks/useMessageSend';
import { useConversationPresence } from '../../hooks/useConversationPresence';
import { useAttachments } from '../../hooks/useAttachments';
import { useAIDraft } from '../../hooks/useAIDraft';
import type { CannedResponse, CustomerContext } from '../../hooks/useCannedResponses';

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
    customerData?: CustomerData;
    // Lifted from hooks — passed in from InboxPage to avoid re-fetching per switch
    cannedResponses: CannedResponse[];
    filteredCanned: CannedResponse[];
    showCanned: boolean;
    setShowCanned: (show: boolean) => void;
    showCannedManager: boolean;
    setShowCannedManager: (show: boolean) => void;
    handleInputForCanned: (input: string) => void;
    selectCanned: (response: CannedResponse, context?: CustomerContext) => string;
    refetchCanned: () => Promise<void>;
    emailAccounts: Array<{ id: string; name: string; email: string; isDefault?: boolean }>;
    selectedEmailAccountId: string;
    onEmailAccountChange: (id: string) => void;
}

export const ChatWindow = memo(function ChatWindow({
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
    customerData,
    // Canned responses (lifted from hook)
    cannedResponses,
    filteredCanned,
    showCanned,
    setShowCanned,
    showCannedManager,
    setShowCannedManager,
    handleInputForCanned,
    selectCanned,
    refetchCanned,
    // Email accounts (lifted from hook)
    emailAccounts,
    selectedEmailAccountId,
    onEmailAccountChange
}: ChatWindowProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const { user } = useAuth();

    // === HOOKS (only per-conversation ones remain here) ===
    const attachments = useAttachments({
        conversationId,
        onSendMessage
    });

    const messageSend = useMessageSend({
        conversationId,
        onSendMessage: attachments.sendMessageWithAttachments,
        recipientEmail,
        isLiveChat: currentChannel === 'CHAT',
        emailAccountId: selectedEmailAccountId
    });

    const { isCustomerTyping } = useTypingIndicator({ conversationId, input: messageSend.input });
    const { otherViewers } = useConversationPresence(conversationId);

    const aiDraft = useAIDraft({
        conversationId,
        currentInput: messageSend.input,
        onDraftGenerated: messageSend.setInput
    });

    // === LOCAL STATE ===
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

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

    // Track previous conversationId to distinguish switch vs new message
    const prevConversationIdRef = useRef(conversationId);

    // Scroll to bottom — instant on switch, smooth for new messages
    useEffect(() => {
        const isSwitching = prevConversationIdRef.current !== conversationId;
        prevConversationIdRef.current = conversationId;
        bottomRef.current?.scrollIntoView({ behavior: isSwitching ? 'instant' : 'smooth' });
    }, [messages, conversationId]);

    // Detect '/' trigger for canned responses
    useEffect(() => {
        handleInputForCanned(messageSend.input);
    }, [messageSend.input, handleInputForCanned]);

    // === FILTERED MESSAGES FOR SEARCH ===
    const filteredMessages = useMemo(() => {
        if (!searchQuery.trim()) return messages;
        const query = searchQuery.toLowerCase();
        return messages.filter(msg => msg.content.toLowerCase().includes(query));
    }, [messages, searchQuery]);

    // === REACTION TOGGLE HANDLER ===
    const handleReactionToggle = useCallback(async (messageId: string, emoji: string) => {
        // Reactions are handled via the attachments hook context
        // This is kept as local since it's simple and doesn't need auth context
    }, []);

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

                {/* Pending Message Bubble with Undo */}
                {messageSend.pendingSend && (
                    <div className="mb-3 flex justify-end">
                        <div className="flex gap-2 max-w-[85%] flex-row-reverse">
                            {/* Avatar placeholder */}
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center self-end">
                                <Loader2 size={16} className="animate-spin text-blue-600" />
                            </div>
                            {/* Pending bubble */}
                            <div className="flex flex-col">
                                <div className="rounded-2xl px-4 py-2.5 relative shadow-sm bg-blue-600/70 text-white rounded-br-md border-2 border-dashed border-blue-400">
                                    <div
                                        className="text-sm leading-relaxed opacity-90"
                                        dangerouslySetInnerHTML={{
                                            __html: DOMPurify.sanitize(messageSend.pendingSend.content, {
                                                ALLOWED_TAGS: ['b', 'i', 'strong', 'em', 'p', 'br', 'a', 'span', 'div', 'img'],
                                                ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'style']
                                            })
                                        }}
                                    />
                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-blue-400/40">
                                        <span className="text-xs text-blue-200">
                                            Sending in {messageSend.pendingSend.remainingSeconds}s...
                                        </span>
                                        <button
                                            onClick={messageSend.cancelPendingSend}
                                            className="text-sm font-semibold text-white bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-colors"
                                        >
                                            Undo
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={bottomRef} />
            </div>

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
                showCanned={showCanned}
                filteredCanned={filteredCanned}
                cannedResponses={cannedResponses}
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
                    messageSend.setInput(selectCanned(r, context));
                }}
                onOpenCannedManager={() => setShowCannedManager(true)}
                isGeneratingDraft={aiDraft.isGeneratingDraft}
                onGenerateAIDraft={aiDraft.handleGenerateAIDraft}
                isUploading={attachments.isUploading}
                uploadProgress={attachments.uploadProgress}
                onFileUpload={attachments.handleFileUpload}
                fileInputRef={attachments.fileInputRef}
                stagedAttachments={attachments.stagedAttachments}
                onRemoveAttachment={attachments.handleRemoveAttachment}
                onOpenSchedule={() => setShowScheduleModal(true)}
                availableChannels={availableChannels}
                currentChannel={currentChannel}
                emailAccounts={emailAccounts}
                selectedEmailAccountId={selectedEmailAccountId}
                onEmailAccountChange={onEmailAccountChange}
            />

            {/* All Modals */}
            <ChatModals
                conversationId={conversationId}
                assigneeId={assigneeId}
                showCannedManager={showCannedManager}
                onCloseCannedManager={() => setShowCannedManager(false)}
                onCannedUpdate={refetchCanned}
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
});
