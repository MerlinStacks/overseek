/**
 * Hook for managing message sending logic in chat conversations.
 * Handles undo delay, quote replies, email signatures, and scheduling.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useSocket } from '../context/SocketContext';
import { useDrafts } from './useDrafts';
import { ConversationChannel } from '../components/chat/ChannelSelector';

interface UseMessageSendOptions {
    conversationId: string;
    onSendMessage: (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean, channel?: ConversationChannel, emailAccountId?: string) => Promise<void>;
    recipientEmail?: string;
    isLiveChat?: boolean;
    emailAccountId?: string;
}

interface PendingSend {
    content: string;
    timeout: NodeJS.Timeout;
    countdownInterval: NodeJS.Timeout;
    remainingSeconds: number;
}

interface UseMessageSendReturn {
    /** Current input value */
    input: string;
    /** Set input value */
    setInput: (value: string) => void;
    /** Whether sending is in progress */
    isSending: boolean;
    /** Currently pending send (for undo UI) */
    pendingSend: PendingSend | null;
    /** Whether a message is an internal note */
    isInternal: boolean;
    /** Toggle internal note mode */
    setIsInternal: (value: boolean) => void;
    /** Email signature enabled state */
    signatureEnabled: boolean;
    /** Toggle email signature */
    setSignatureEnabled: (value: boolean) => void;
    /** Quoted message for reply */
    quotedMessage: { id: string; content: string; senderType: string } | null;
    /** Set quoted message */
    setQuotedMessage: (msg: { id: string; content: string; senderType: string } | null) => void;
    /** Send the current message */
    handleSend: (e?: React.FormEvent, channel?: ConversationChannel) => void;
    /** Cancel a pending send (undo) */
    cancelPendingSend: () => void;
    /** Schedule a message for later */
    handleScheduleMessage: (scheduledFor: Date) => Promise<void>;
    /** Whether scheduling is in progress */
    isScheduling: boolean;
    /** Undo delay in milliseconds */
    UNDO_DELAY_MS: number;
}

const UNDO_DELAY_MS = 5000;

/**
 * Manages message sending with undo capability, quote replies, and scheduling.
 */
export function useMessageSend({
    conversationId,
    onSendMessage,
    recipientEmail,
    isLiveChat,
    emailAccountId
}: UseMessageSendOptions): UseMessageSendReturn {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const { socket } = useSocket();
    const { getDraft, saveDraft, clearDraft } = useDrafts();

    const [input, setInput] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [signatureEnabled, setSignatureEnabled] = useState(true);
    const [quotedMessage, setQuotedMessage] = useState<{ id: string; content: string; senderType: string } | null>(null);
    const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
    const [isScheduling, setIsScheduling] = useState(false);

    // Load draft when conversation changes
    useEffect(() => {
        if (conversationId) {
            const savedDraft = getDraft(conversationId);
            setInput(savedDraft);
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

    /**
     * Cancel a pending send and restore input.
     */
    const cancelPendingSend = useCallback(() => {
        if (pendingSend) {
            clearTimeout(pendingSend.timeout);
            clearInterval(pendingSend.countdownInterval);
            setInput(pendingSend.content);
            setPendingSend(null);
        }
    }, [pendingSend]);

    /**
     * Prepare message content with quote and signature.
     */
    const prepareContent = useCallback((messageContent: string): string => {
        let content = messageContent;

        // Prepend quoted message if present
        if (quotedMessage) {
            const quotedText = quotedMessage.content.replace(/<[^>]*>/g, '').substring(0, 100);
            content = `<blockquote style="border-left: 2px solid #ccc; margin: 0 0 10px 0; padding-left: 10px; color: #666;">${quotedText}${quotedText.length >= 100 ? '...' : ''}</blockquote>${content}`;
        }

        // Append email signature for email replies (not internal notes)
        const shouldAppendSignature = signatureEnabled &&
            user?.emailSignature &&
            !isInternal &&
            recipientEmail &&
            !isLiveChat;

        if (shouldAppendSignature) {
            content = `${content}\n\n---\n${user!.emailSignature}`;
        }

        return content;
    }, [quotedMessage, signatureEnabled, user, isInternal, recipientEmail]);

    /**
     * Send the current message with undo delay.
     */
    const handleSend = useCallback((e?: React.FormEvent, channel?: ConversationChannel) => {
        e?.preventDefault();

        // Strip HTML to check for actual content
        const plainText = input.replace(/<[^>]*>/g, '').trim();
        if (!plainText || isSending || pendingSend) return;

        const finalContent = prepareContent(input);

        // Store content and start undo timer with countdown
        const startSeconds = Math.ceil(UNDO_DELAY_MS / 1000);

        const timeout = setTimeout(async () => {
            setIsSending(true);
            try {
                await onSendMessage(finalContent, 'AGENT', isInternal, channel, emailAccountId);
                clearDraft(conversationId);
            } finally {
                setIsSending(false);
                setPendingSend(null);
            }
        }, UNDO_DELAY_MS);

        // Start countdown interval
        const countdownInterval = setInterval(() => {
            setPendingSend(prev => {
                if (!prev || prev.remainingSeconds <= 1) return prev;
                return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
            });
        }, 1000);

        setPendingSend({ content: input, timeout, countdownInterval, remainingSeconds: startSeconds });
        setInput('');
        setQuotedMessage(null);

        // Emit typing stop
        if (socket && conversationId) {
            socket.emit('typing:stop', { conversationId });
        }
    }, [input, isSending, pendingSend, prepareContent, onSendMessage, isInternal, clearDraft, conversationId, socket, emailAccountId]);

    /**
     * Schedule a message for later delivery.
     */
    const handleScheduleMessage = useCallback(async (scheduledFor: Date) => {
        const plainText = input.replace(/<[^>]*>/g, '').trim();
        if (!plainText || !token || !currentAccount) return;

        setIsScheduling(true);
        try {
            const finalContent = prepareContent(input);

            const res = await fetch(`/api/chat/${conversationId}/messages/schedule`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                body: JSON.stringify({
                    content: finalContent,
                    scheduledFor: scheduledFor.toISOString(),
                    isInternal,
                }),
            });

            if (!res.ok) {
                const error = await res.json();
                alert(error.error || 'Failed to schedule message');
                return;
            }

            // Clear input on success
            setInput('');
            clearDraft(conversationId);

            // Show success toast
            alert(`Message scheduled for ${scheduledFor.toLocaleString()}`);
        } catch (error) {
            Logger.error('Schedule message error:', { error: error });
            alert('Failed to schedule message. Please try again.');
        } finally {
            setIsScheduling(false);
        }
    }, [input, token, currentAccount, conversationId, prepareContent, isInternal, clearDraft]);

    return {
        input,
        setInput,
        isSending,
        pendingSend,
        isInternal,
        setIsInternal,
        signatureEnabled,
        setSignatureEnabled,
        quotedMessage,
        setQuotedMessage,
        handleSend,
        cancelPendingSend,
        handleScheduleMessage,
        isScheduling,
        UNDO_DELAY_MS
    };
}
