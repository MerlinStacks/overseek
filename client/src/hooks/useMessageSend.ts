/**
 * Hook for managing message sending logic in chat conversations.
 * Handles undo delay, quote replies, email signatures, and scheduling.
 */
import { useState, useCallback, useRef, useEffect, type MutableRefObject } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useSocket } from '../context/SocketContext';
import { useDrafts } from './useDrafts';
import { ConversationChannel } from '../components/chat/ChannelSelector';
import { lintOutboundMessage, type OutboundSafetyIssue } from '../utils/outboundSafety';

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
    /** Outbound safety findings for current message */
    safetyIssues: OutboundSafetyIssue[];
    /** Whether this outbound message needs explicit approval before send */
    requiresSafetyApproval: boolean;
    /** Approves and re-attempts current send */
    approveSafetyAndSend: (channel?: ConversationChannel) => void;
    /** Clear current safety findings/approval gate */
    dismissSafetyWarnings: () => void;
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
    const [safetyIssues, setSafetyIssues] = useState<OutboundSafetyIssue[]>([]);
    const [requiresSafetyApproval, setRequiresSafetyApproval] = useState(false);
    const isDraftingRef = useRef(false);
    const draftStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Ref that always holds the latest pendingSend - avoids stale closure
    // when the conversation-switch effect fires.
    const pendingSendRef: MutableRefObject<PendingSend | null> = useRef(null);
    pendingSendRef.current = pendingSend;

    // Load draft when conversation changes
    useEffect(() => {
        if (conversationId) {
            const savedDraft = getDraft(conversationId);
            setInput(savedDraft);
            setQuotedMessage(null);
            // Cancel any pending send using ref to avoid stale closure
            const pending = pendingSendRef.current;
            if (pending) {
                clearTimeout(pending.timeout);
                clearInterval(pending.countdownInterval);
                setPendingSend(null);
            }
        }
    }, [conversationId, getDraft]);

    // Why: if component unmounts while a send is pending, the timeout and
    // countdownInterval keep running, firing setState on an unmounted component.
    useEffect(() => {
        return () => {
            const pending = pendingSendRef.current;
            if (pending) {
                clearTimeout(pending.timeout);
                clearInterval(pending.countdownInterval);
            }
        };
    }, []);

    // Broadcast agent drafting presence to reduce reply collisions.
    useEffect(() => {
        const plainText = input.replace(/<[^>]*>/g, '').trim();
        const shouldDraftBroadcast = Boolean(plainText) && !isInternal;
        const userId = user?.id;
        if (!socket || !conversationId || !userId) return;

        if (shouldDraftBroadcast && !isDraftingRef.current) {
            socket.emit('agent:draft:start', {
                conversationId,
                user: {
                    id: userId,
                    name: user.fullName || user.email || 'Agent',
                    avatarUrl: user.avatarUrl || null
                }
            });
            isDraftingRef.current = true;
        }

        if (draftStopTimeoutRef.current) {
            clearTimeout(draftStopTimeoutRef.current);
            draftStopTimeoutRef.current = null;
        }

        if (isDraftingRef.current) {
            draftStopTimeoutRef.current = setTimeout(() => {
                socket.emit('agent:draft:stop', { conversationId, userId });
                isDraftingRef.current = false;
            }, 2500);
        }

        return () => {
            if (draftStopTimeoutRef.current) {
                clearTimeout(draftStopTimeoutRef.current);
                draftStopTimeoutRef.current = null;
            }
        };
    }, [input, isInternal, socket, conversationId, user?.id, user?.fullName, user?.email, user?.avatarUrl]);

    // Ensure drafting state is cleared when changing threads/unmounting.
    useEffect(() => {
        return () => {
            const userId = user?.id;
            if (socket && conversationId && userId && isDraftingRef.current) {
                socket.emit('agent:draft:stop', { conversationId, userId });
                isDraftingRef.current = false;
            }
        };
    }, [socket, conversationId, user?.id]);

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

    const dismissSafetyWarnings = useCallback(() => {
        setSafetyIssues([]);
        setRequiresSafetyApproval(false);
    }, []);

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
    }, [quotedMessage, signatureEnabled, user, isInternal, recipientEmail, isLiveChat]);

    /**
     * Send the current message with undo delay.
     */
    const handleSend = useCallback((e?: React.FormEvent, channel?: ConversationChannel) => {
        e?.preventDefault();

        // Strip HTML to check for actual content
        const plainText = input.replace(/<[^>]*>/g, '').trim();
        if (!plainText || isSending || pendingSend) return;

        if (!isInternal) {
            const issues = lintOutboundMessage(plainText);
            if (issues.length > 0 && !requiresSafetyApproval) {
                setSafetyIssues(issues);
                setRequiresSafetyApproval(true);
                return;
            }
        }

        // Approval was used for this send; reset for next message.
        setSafetyIssues([]);
        setRequiresSafetyApproval(false);

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
            if (user?.id && isDraftingRef.current) {
                socket.emit('agent:draft:stop', { conversationId, userId: user.id });
                isDraftingRef.current = false;
            }
        }
    }, [input, isSending, pendingSend, prepareContent, onSendMessage, isInternal, clearDraft, conversationId, socket, emailAccountId, user?.id, requiresSafetyApproval]);

    const approveSafetyAndSend = useCallback((channel?: ConversationChannel) => {
        setRequiresSafetyApproval(false);
        handleSend(undefined, channel);
    }, [handleSend]);

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
                const errData = await res.json();
                Logger.warn('Failed to schedule message', { error: errData.error });
                return;
            }

            // Clear input on success
            setInput('');
            clearDraft(conversationId);
            Logger.info('Message scheduled', { scheduledFor: scheduledFor.toISOString() });
        } catch (error) {
            Logger.error('Schedule message error:', { error: error });
        } finally {
            setIsScheduling(false);
        }
    }, [input, token, currentAccount, conversationId, prepareContent, isInternal, clearDraft]);

    useEffect(() => {
        if (!requiresSafetyApproval && safetyIssues.length === 0) return;
        // Message edits should force a new linting pass before approval.
        setRequiresSafetyApproval(false);
        setSafetyIssues([]);
    }, [input, isInternal, requiresSafetyApproval, safetyIssues.length]);

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
        UNDO_DELAY_MS,
        safetyIssues,
        requiresSafetyApproval,
        approveSafetyAndSend,
        dismissSafetyWarnings
    };
}
