/**
 * ChatWindow - Orchestration component for chat conversations.
 * Delegates compose, typing, and send logic to extracted hooks and components.
 * Memoized to prevent re-renders from parent state changes (e.g. conversation list updates).
 */
import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';

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
    status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'PENDING';
    reactions?: Record<string, Array<{ userId: string; userName: string | null }>>;
    pendingUndo?: boolean;
    remainingSeconds?: number;
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
    onSendMessage: (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean, channel?: ConversationChannel, emailAccountId?: string, clientRequestId?: string) => Promise<void>;
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
    setShowCanned: _setShowCanned,
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
    const { socket } = useSocket();

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
    const [activeDraftingAgents, setActiveDraftingAgents] = useState<Array<{ id: string; name: string; avatarUrl?: string | null }>>([]);

    // Reset search when changing conversations
    useEffect(() => {
        setShowSearch(false);
        setSearchQuery('');
        setActiveDraftingAgents([]);
    }, [conversationId]);

    // Track other agents currently drafting in this thread (collision safety).
    useEffect(() => {
        if (!socket) return;

        const handleDraftStart = (payload: {
            conversationId: string;
            user: { id: string; name: string; avatarUrl?: string | null };
        }) => {
            if (!payload?.conversationId || payload.conversationId !== conversationId) return;
            if (!payload.user?.id || payload.user.id === user?.id) return;
            setActiveDraftingAgents(prev => {
                if (prev.some(a => a.id === payload.user.id)) return prev;
                return [...prev, payload.user];
            });
        };

        const handleDraftStop = (payload: { conversationId: string; userId: string }) => {
            if (!payload?.conversationId || payload.conversationId !== conversationId) return;
            if (!payload.userId) return;
            setActiveDraftingAgents(prev => prev.filter(a => a.id !== payload.userId));
        };

        socket.on('agent:draft:start', handleDraftStart);
        socket.on('agent:draft:stop', handleDraftStop);
        return () => {
            socket.off('agent:draft:start', handleDraftStart);
            socket.off('agent:draft:stop', handleDraftStop);
        };
    }, [conversationId, socket, user?.id]);

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
        const renderedMessages = messageSend.pendingSend
            ? [
                ...messages,
                {
                    id: messageSend.pendingSend.tempId,
                    content: messageSend.pendingSend.content,
                    senderType: 'AGENT' as const,
                    createdAt: messageSend.pendingSend.createdAt,
                    isInternal: messageSend.isInternal,
                    status: 'PENDING' as const,
                    pendingUndo: true,
                    remainingSeconds: messageSend.pendingSend.remainingSeconds,
                }
            ]
            : messages;

        if (!searchQuery.trim()) return renderedMessages;
        const query = searchQuery.toLowerCase();
        return renderedMessages.filter(msg => msg.content.toLowerCase().includes(query));
    }, [messages, searchQuery, messageSend.pendingSend, messageSend.isInternal]);

    // NOTE: Reaction toggle API is not yet implemented.
    // When ready, add a callback here and pass it to MessageBubble via onReactionToggle.

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
                        onUndoPending={msg.id === messageSend.pendingSend?.tempId ? messageSend.cancelPendingSend : undefined}
                    />
                ))}

                {/* Typing Indicator */}
                {isCustomerTyping && <TypingIndicator name={recipientName} />}

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
                attachmentError={attachments.attachmentError}
                onOpenSchedule={() => setShowScheduleModal(true)}
                availableChannels={availableChannels}
                currentChannel={currentChannel}
                emailAccounts={emailAccounts}
                selectedEmailAccountId={selectedEmailAccountId}
                onEmailAccountChange={onEmailAccountChange}
                activeDraftingAgents={activeDraftingAgents}
                safetyIssues={messageSend.safetyIssues}
                requiresSafetyApproval={messageSend.requiresSafetyApproval}
                onApproveSafetySend={messageSend.approveSafetyAndSend}
                onDismissSafetyWarnings={messageSend.dismissSafetyWarnings}
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
