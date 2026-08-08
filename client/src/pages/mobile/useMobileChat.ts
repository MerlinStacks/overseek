/**
 * useMobileChat — encapsulates all state, data-fetching, and mutation
 * logic for the mobile chat view.
 *
 * Why: MobileChat.tsx was a 588-line god-component with 6 inline fetch
 * calls all repeating auth headers. This hook extracts that logic so
 * the page component is purely presentational.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useSocket } from '../../context/SocketContext';
import { useCannedResponses } from '../../hooks/useCannedResponses';
import type { MessageSendResponse } from '../../types/inbox';

interface MessageApiResponse {
    id: string;
    content?: string;
    senderType?: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
    createdAt?: string;
    sender?: { fullName?: string };
    clientRequestId?: string;
    deliveryStatus?: 'PENDING' | 'SENT' | 'FAILED';
    deliveryError?: string | null;
}

export interface MobileChatMessage {
    id: string;
    body: string;
    direction: 'inbound' | 'outbound';
    createdAt: string;
    senderName?: string;
    clientRequestId?: string;
    deliveryStatus?: 'PENDING' | 'SENT' | 'FAILED';
    deliveryError?: string | null;
}

export interface MobileChatConversation {
    id: string;
    customerName: string;
    customerEmail?: string;
    channel: string;
    status: string;
}

/** Shared auth headers builder — eliminates per-fetch boilerplate */
function buildHeaders(token: string, accountId: string, json = false) {
    const h: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'X-Account-ID': accountId,
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

/** Trigger haptic feedback on devices that support it */
function haptic() {
    if ('vibrate' in navigator) navigator.vibrate(10);
}

function toMobileMessage(message: MessageApiResponse, fallbackBody = ''): MobileChatMessage {
    return {
        id: message.id,
        body: message.content || fallbackBody,
        direction: message.senderType === 'CUSTOMER' ? 'inbound' : 'outbound',
        createdAt: message.createdAt || new Date().toISOString(),
        senderName: message.sender?.fullName || (message.senderType === 'AGENT' ? 'Agent' : 'Customer'),
        clientRequestId: message.clientRequestId,
        deliveryStatus: message.deliveryStatus,
        deliveryError: message.deliveryError,
    };
}

export function useMobileChat(conversationId: string | undefined) {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const { socket } = useSocket();

    const [conversation, setConversation] = useState<MobileChatConversation | null>(null);
    const [messages, setMessages] = useState<MobileChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isNearBottomRef = useRef(true);
    const previousMessageCountRef = useRef(0);
    const fetchControllerRef = useRef<AbortController | null>(null);
    const sendControllerRef = useRef<AbortController | null>(null);
    const uploadControllerRef = useRef<AbortController | null>(null);
    const draftControllerRef = useRef<AbortController | null>(null);
    const actionControllerRef = useRef<AbortController | null>(null);
    const retrySendRef = useRef<{ conversationId: string; accountId: string; content: string; clientRequestId: string } | null>(null);
    const retryUploadRef = useRef<{ conversationId: string; accountId: string; fingerprint: string; clientRequestId: string } | null>(null);
    const identityRef = useRef({ conversationId, accountId: currentAccount?.id });
    identityRef.current = { conversationId, accountId: currentAccount?.id };

    // Canned responses
    const {
        cannedResponses,
        filteredCanned,
        showCanned,
        handleInputForCanned,
        selectCanned,
        setShowCanned,
    } = useCannedResponses();

    // Customer context for canned response placeholders
    const customerContext = useMemo(() => {
        if (!conversation) return undefined;
        return {
            firstName: conversation.customerName.split(' ')[0],
            lastName: conversation.customerName.split(' ').slice(1).join(' '),
            email: conversation.customerEmail,
            agentFirstName: user?.fullName?.split(' ')[0],
            agentFullName: user?.fullName ?? undefined,
        };
    }, [conversation, user?.fullName]);

    // -------------------------------------------------------
    // Data fetching
    // -------------------------------------------------------

    const fetchConversation = useCallback(async () => {
        if (!currentAccount || !token || !conversationId) {
            setConversation(null);
            setMessages([]);
            setLoading(false);
            return;
        }

        fetchControllerRef.current?.abort();
        const controller = new AbortController();
        fetchControllerRef.current = controller;
        try {
            const headers = buildHeaders(token, currentAccount.id);

            const convRes = await fetch(`/api/chat/${conversationId}`, { headers, signal: controller.signal });
            if (controller.signal.aborted || identityRef.current.conversationId !== conversationId || identityRef.current.accountId !== currentAccount.id) return;
            if (!convRes.ok) {
                setConversation(null);
                setMessages([]);
                Logger.warn('[MobileChat] Failed to fetch conversation', {
                    conversationId,
                    status: convRes.status,
                });
                return;
            }

            const conv = await convRes.json();
            if (controller.signal.aborted || identityRef.current.conversationId !== conversationId || identityRef.current.accountId !== currentAccount.id) return;
            const customerName = conv.wooCustomer
                ? `${conv.wooCustomer.firstName || ''} ${conv.wooCustomer.lastName || ''}`.trim() || conv.wooCustomer.email
                : conv.guestName || conv.guestEmail || 'Unknown';

            setConversation({
                id: conv.id,
                customerName,
                customerEmail: conv.wooCustomer?.email || conv.guestEmail,
                channel: (conv.channel || 'CHAT').toLowerCase(),
                status: conv.status,
            });

            void fetch(`/api/chat/${conversationId}/read`, {
                method: 'POST',
                headers,
            }).catch((error) => {
                Logger.error('[MobileChat] Failed to mark conversation as read', {
                    error,
                    conversationId,
                });
            });

            if (conv.messages && Array.isArray(conv.messages)) {
                setMessages(conv.messages.map((m: MessageApiResponse) => toMobileMessage(m)));
            } else {
                setMessages([]);
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            setConversation(null);
            setMessages([]);
            Logger.error('[MobileChat] Error:', { error });
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, [currentAccount, token, conversationId]);

    // -------------------------------------------------------
    // Actions
    // -------------------------------------------------------

    const handleSend = useCallback(async () => {
        if (!newMessage.trim() || sending || !currentAccount || !token || !conversation || conversation.id !== conversationId) return;

        setSending(true);
        haptic();
        const requestConversationId = conversationId;
        const requestAccountId = currentAccount.id;
        const content = newMessage.trim();
        const retry = retrySendRef.current;
        const clientRequestId = retry?.conversationId === requestConversationId && retry.accountId === requestAccountId && retry.content === content
            ? retry.clientRequestId
            : `mobile-${requestConversationId}-${crypto.randomUUID()}`;
        retrySendRef.current = { conversationId: requestConversationId, accountId: requestAccountId, content, clientRequestId };
        const controller = new AbortController();
        sendControllerRef.current?.abort();
        sendControllerRef.current = controller;

        try {
            const res = await fetch(`/api/chat/${requestConversationId}/messages`, {
                method: 'POST',
                headers: buildHeaders(token, requestAccountId, true),
                body: JSON.stringify({
                    content,
                    channel: conversation.channel.toUpperCase(),
                    clientRequestId,
                }),
                signal: controller.signal,
            });

            const data = await res.json().catch(() => ({})) as MessageApiResponse & MessageSendResponse;
            if (controller.signal.aborted || identityRef.current.conversationId !== requestConversationId || identityRef.current.accountId !== requestAccountId) return;
            const sent = res.ok ? data : data.message;
            if (sent?.id) {
                const mobileMessage = toMobileMessage(sent, content);
                setMessages(prev => {
                    const index = prev.findIndex(message => message.id === mobileMessage.id || Boolean(mobileMessage.clientRequestId && message.clientRequestId === mobileMessage.clientRequestId));
                    return index >= 0 ? prev.map((message, i) => i === index ? mobileMessage : message) : [...prev, mobileMessage];
                });
            }
            if (!res.ok) throw new Error(data.error || data.message?.deliveryError || `Send failed with status ${res.status}`);

            retrySendRef.current = null;
            setSendError(null);
            setNewMessage('');
            inputRef.current?.focus();
        } catch (error) {
            if (controller.signal.aborted) return;
            Logger.error('[MobileChat] Send error:', { error });
            if (identityRef.current.conversationId === requestConversationId && identityRef.current.accountId === requestAccountId) {
                setSendError(error instanceof Error ? error.message : 'Message delivery failed');
            }
        } finally {
            if (sendControllerRef.current === controller) {
                sendControllerRef.current = null;
                setSending(false);
            }
        }
    }, [newMessage, sending, currentAccount, token, conversationId, conversation]);

    const handleResolve = useCallback(async () => {
        setShowMenu(false);
        if (!currentAccount || !token || !conversationId) return false;
        const requestConversationId = conversationId;
        const requestAccountId = currentAccount.id;
        actionControllerRef.current?.abort();
        const controller = new AbortController();
        actionControllerRef.current = controller;
        try {
            const res = await fetch(`/api/chat/${requestConversationId}`, {
                method: 'PUT',
                headers: buildHeaders(token, requestAccountId, true),
                body: JSON.stringify({ status: 'CLOSED' }),
                signal: controller.signal,
            });
            if (controller.signal.aborted || identityRef.current.conversationId !== requestConversationId || identityRef.current.accountId !== requestAccountId) return false;
            if (!res.ok) {
                throw new Error(`Resolve failed with status ${res.status}`);
            }
            return true; // Signal navigation to caller
        } catch (error) {
            if (controller.signal.aborted) return false;
            Logger.error('[MobileChat] Resolve error:', { error });
            return false;
        } finally {
            if (actionControllerRef.current === controller) actionControllerRef.current = null;
        }
    }, [currentAccount, token, conversationId]);

    const handleBlock = useCallback(async () => {
        setShowMenu(false);
        if (!currentAccount || !token || !conversationId) return false;
        const requestConversationId = conversationId;
        const requestAccountId = currentAccount.id;
        actionControllerRef.current?.abort();
        const controller = new AbortController();
        actionControllerRef.current = controller;
        try {
            const res = await fetch(`/api/chat/${requestConversationId}/block`, {
                method: 'POST',
                headers: buildHeaders(token, requestAccountId, true),
                body: JSON.stringify({ reason: 'Blocked from mobile' }),
                signal: controller.signal,
            });
            if (controller.signal.aborted || identityRef.current.conversationId !== requestConversationId || identityRef.current.accountId !== requestAccountId) return false;
            if (!res.ok) {
                throw new Error(`Block failed with status ${res.status}`);
            }
            return true; // Signal navigation to caller
        } catch (error) {
            if (controller.signal.aborted) return false;
            Logger.error('[MobileChat] Block error:', { error });
            return false;
        } finally {
            if (actionControllerRef.current === controller) actionControllerRef.current = null;
        }
    }, [currentAccount, token, conversationId]);

    const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentAccount || !token || !conversation || conversation.id !== conversationId) return;

        setIsUploading(true);
        haptic();
        const requestConversationId = conversationId;
        const requestAccountId = currentAccount.id;
        const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
        const retry = retryUploadRef.current;
        const clientRequestId = retry?.conversationId === requestConversationId && retry.accountId === requestAccountId && retry.fingerprint === fingerprint
            ? retry.clientRequestId
            : `mobile-attachment-${requestConversationId}-${crypto.randomUUID()}`;
        retryUploadRef.current = { conversationId: requestConversationId, accountId: requestAccountId, fingerprint, clientRequestId };
        const controller = new AbortController();
        uploadControllerRef.current?.abort();
        uploadControllerRef.current = controller;

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('content', '');
            formData.append('channel', conversation.channel.toUpperCase());
            formData.append('clientRequestId', clientRequestId);

            const res = await fetch(`/api/chat/${requestConversationId}/message-with-attachments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': requestAccountId,
                },
                body: formData,
                signal: controller.signal,
            });

            const data = await res.json().catch(() => ({})) as MessageSendResponse;
            if (controller.signal.aborted || identityRef.current.conversationId !== requestConversationId || identityRef.current.accountId !== requestAccountId) return;
            const { message } = data;
            if (message) {
                const mobileMessage = toMobileMessage(message, `Attachment: ${file.name}`);
                setMessages(prev => {
                    const index = prev.findIndex(item => item.id === mobileMessage.id || Boolean(mobileMessage.clientRequestId && item.clientRequestId === mobileMessage.clientRequestId));
                    return index >= 0 ? prev.map((item, i) => i === index ? mobileMessage : item) : [...prev, mobileMessage];
                });
            }
            if (!res.ok) throw new Error(data.error || data.message?.deliveryError || `Upload failed with status ${res.status}`);

            retryUploadRef.current = null;
            setSendError(null);
            inputRef.current?.focus();
        } catch (error) {
            if (controller.signal.aborted) return;
            Logger.error('[MobileChat] Upload error:', { error });
            if (identityRef.current.conversationId === requestConversationId && identityRef.current.accountId === requestAccountId) {
                setSendError(error instanceof Error ? error.message : 'Attachment delivery failed');
            }
        } finally {
            if (uploadControllerRef.current === controller) {
                uploadControllerRef.current = null;
                setIsUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        }
    }, [currentAccount, token, conversationId, conversation]);

    const handleGenerateAIDraft = useCallback(async () => {
        if (!currentAccount || !token || isGeneratingDraft) return;

        setIsGeneratingDraft(true);
        haptic();
        const requestConversationId = conversationId;
        const requestAccountId = currentAccount.id;
        const controller = new AbortController();
        draftControllerRef.current?.abort();
        draftControllerRef.current = controller;

        try {
            const res = await fetch(`/api/chat/${requestConversationId}/ai-draft`, {
                method: 'POST',
                headers: buildHeaders(token, requestAccountId, true),
                body: JSON.stringify({ currentDraft: newMessage || '' }),
                signal: controller.signal,
            });

            if (res.ok) {
                const { draft } = await res.json();
                if (controller.signal.aborted || identityRef.current.conversationId !== requestConversationId || identityRef.current.accountId !== requestAccountId) return;
                setNewMessage(draft);
                inputRef.current?.focus();
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            Logger.error('[MobileChat] AI draft error:', { error });
        } finally {
            if (draftControllerRef.current === controller) {
                draftControllerRef.current = null;
                setIsGeneratingDraft(false);
            }
        }
    }, [currentAccount, token, isGeneratingDraft, conversationId, newMessage]);

    // -------------------------------------------------------
    // Input helpers
    // -------------------------------------------------------

    const handleInputChange = useCallback((value: string) => {
        if (retrySendRef.current?.content !== value.trim()) retrySendRef.current = null;
        setSendError(null);
        setNewMessage(value);
        handleInputForCanned(value);
    }, [handleInputForCanned]);

    const handleSelectCanned = useCallback((response: typeof cannedResponses[0]) => {
        const content = selectCanned(response, customerContext);
        setNewMessage(content);
        setShowCanned(false);
        inputRef.current?.focus();
    }, [selectCanned, customerContext, setShowCanned]);

    const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && !showCanned) {
            e.preventDefault();
            handleSend();
        }
    }, [showCanned, handleSend]);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, []);

    const handleMessagesScroll = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        isNearBottomRef.current = distanceFromBottom < 120;
    }, []);

    // -------------------------------------------------------
    // Effects
    // -------------------------------------------------------

    useEffect(() => {
        fetchConversation();
        const handleRefresh = () => fetchConversation();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => {
            fetchControllerRef.current?.abort();
            window.removeEventListener('mobile-refresh', handleRefresh);
        };
    }, [fetchConversation]);

    useEffect(() => {
        sendControllerRef.current?.abort();
        uploadControllerRef.current?.abort();
        draftControllerRef.current?.abort();
        actionControllerRef.current?.abort();
        retrySendRef.current = null;
        retryUploadRef.current = null;
        setConversation(null);
        setMessages([]);
        setNewMessage('');
        setSending(false);
        setIsUploading(false);
        setIsGeneratingDraft(false);
        setSendError(null);
        setShowMenu(false);
        isNearBottomRef.current = true;
        previousMessageCountRef.current = 0;
        return () => {
            sendControllerRef.current?.abort();
            uploadControllerRef.current?.abort();
            draftControllerRef.current?.abort();
            actionControllerRef.current?.abort();
        };
    }, [conversationId, currentAccount?.id]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        container.addEventListener('scroll', handleMessagesScroll, { passive: true });
        handleMessagesScroll();

        return () => {
            container.removeEventListener('scroll', handleMessagesScroll);
        };
    }, [handleMessagesScroll]);

    useEffect(() => {
        if (!socket || !conversationId || !user || !currentAccount?.id) {
            return;
        }

        socket.emit('join:conversation', {
            conversationId,
            user: {
                id: user.id,
                name: user.fullName || user.email || 'Agent',
                avatarUrl: user.avatarUrl
            }
        });

        const handleMessageNew = (payload: MessageApiResponse & { conversationId?: string; accountId?: string }) => {
            if (payload.accountId && payload.accountId !== currentAccount.id) return;
            if (payload.conversationId !== conversationId) return;

            setMessages(prev => {
                if (prev.some(msg => msg.id === payload.id)) return prev;
                return [...prev, toMobileMessage(payload)];
            });
        };

        socket.on('message:new', handleMessageNew);

        return () => {
            socket.emit('leave:conversation', { conversationId });
            socket.off('message:new', handleMessageNew);
        };
    }, [socket, conversationId, user, currentAccount?.id]);

    useEffect(() => {
        const hadMessages = previousMessageCountRef.current;
        const hasNewMessages = messages.length > hadMessages;
        previousMessageCountRef.current = messages.length;

        if (messages.length === 0 || !hasNewMessages) return;
        if (!isNearBottomRef.current) return;

        const behavior: ScrollBehavior = hadMessages === 0 ? 'auto' : 'smooth';
        scrollToBottom(behavior);
    }, [messages, scrollToBottom]);

    // -------------------------------------------------------
    // Public API
    // -------------------------------------------------------

    return {
        // State
        conversation,
        messages,
        newMessage,
        loading,
        sending,
        showMenu,
        setShowMenu,
        isUploading,
        isGeneratingDraft,
        sendError,

        // Refs
        messagesEndRef,
        messagesContainerRef,
        inputRef,
        fileInputRef,

        // Canned responses
        cannedResponses,
        filteredCanned,
        showCanned,

        // Actions
        handleSend,
        handleResolve,
        handleBlock,
        handleFileUpload,
        handleGenerateAIDraft,
        handleInputChange,
        handleSelectCanned,
        handleKeyPress,
    };
}
