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
    mergedRecipients = []
}: ChatWindowProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { token } = useAuth();
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

    // === EXTRACTED HOOKS ===
    const canned = useCannedResponses();
    const messageSend = useMessageSend({
        conversationId,
        onSendMessage,
        recipientEmail,
        isLiveChat: currentChannel === 'CHAT',
        emailAccountId: selectedEmailAccountId
    });
    const { isCustomerTyping } = useTypingIndicator({ conversationId, input: messageSend.input });
    const { otherViewers } = useConversationPresence(conversationId);

    // === LOCAL STATE ===
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
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

    // === FILE UPLOAD ===
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
        } catch (error) {
            Logger.error('Upload failed:', { error: error });
            alert('Upload failed');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
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
                body: JSON.stringify({})
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
                onSelectCanned={(r) => messageSend.setInput(canned.selectCanned(r))}
                onOpenCannedManager={() => canned.setShowCannedManager(true)}
                isGeneratingDraft={isGeneratingDraft}
                onGenerateAIDraft={handleGenerateAIDraft}
                isUploading={isUploading}
                onFileUpload={handleFileUpload}
                fileInputRef={fileInputRef}
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
