/**
 * useMobileChat — encapsulates all state, data-fetching, and mutation
 * logic for the mobile chat view.
 *
 * Why: MobileChat.tsx was a 588-line god-component with 6 inline fetch
 * calls all repeating auth headers. This hook extracts that logic so
 * the page component is purely presentational.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useCannedResponses } from '../../hooks/useCannedResponses';

interface MessageApiResponse {
    id: string;
    content?: string;
    senderType?: 'AGENT' | 'CUSTOMER';
    createdAt?: string;
    sender?: { fullName?: string };
}

export interface MobileChatMessage {
    id: string;
    body: string;
    direction: 'inbound' | 'outbound';
    createdAt: string;
    senderName?: string;
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

export function useMobileChat(conversationId: string | undefined) {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    const [conversation, setConversation] = useState<MobileChatConversation | null>(null);
    const [messages, setMessages] = useState<MobileChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
    const customerContext = conversation ? {
        firstName: conversation.customerName.split(' ')[0],
        lastName: conversation.customerName.split(' ').slice(1).join(' '),
        email: conversation.customerEmail,
        agentFirstName: user?.fullName?.split(' ')[0],
        agentFullName: user?.fullName ?? undefined,
    } : undefined;

    // -------------------------------------------------------
    // Data fetching
    // -------------------------------------------------------

    const fetchConversation = useCallback(async () => {
        if (!currentAccount || !token || !conversationId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const headers = buildHeaders(token, currentAccount.id);

            const convRes = await fetch(`/api/chat/${conversationId}`, { headers });
            if (convRes.ok) {
                const conv = await convRes.json();
                const customerName = conv.wooCustomer
                    ? `${conv.wooCustomer.firstName || ''} ${conv.wooCustomer.lastName || ''}`.trim() || conv.wooCustomer.email
                    : conv.guestName || conv.guestEmail || 'Unknown';

                setConversation({
                    id: conv.id,
                    customerName,
                    customerEmail: conv.wooCustomer?.email || conv.guestEmail,
                    channel: conv.channel || 'CHAT',
                    status: conv.status,
                });

                if (conv.messages && Array.isArray(conv.messages)) {
                    setMessages(conv.messages.map((m: MessageApiResponse) => ({
                        id: m.id,
                        body: m.content || '',
                        direction: m.senderType === 'AGENT' ? 'outbound' as const : 'inbound' as const,
                        createdAt: m.createdAt || '',
                        senderName: m.sender?.fullName || (m.senderType === 'AGENT' ? 'Agent' : 'Customer'),
                    })));
                }
            }
        } catch (error) {
            Logger.error('[MobileChat] Error:', { error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token, conversationId]);

    // -------------------------------------------------------
    // Actions
    // -------------------------------------------------------

    const handleSend = useCallback(async () => {
        if (!newMessage.trim() || sending || !currentAccount || !token) return;

        setSending(true);
        haptic();

        try {
            const res = await fetch(`/api/chat/${conversationId}/messages`, {
                method: 'POST',
                headers: buildHeaders(token, currentAccount.id, true),
                body: JSON.stringify({ content: newMessage.trim() }),
            });

            if (res.ok) {
                const sent = await res.json();
                setMessages(prev => [...prev, {
                    id: sent.id || Date.now().toString(),
                    body: newMessage.trim(),
                    direction: 'outbound' as const,
                    createdAt: new Date().toISOString(),
                }]);
                setNewMessage('');
                inputRef.current?.focus();
            }
        } catch (error) {
            Logger.error('[MobileChat] Send error:', { error });
        } finally {
            setSending(false);
        }
    }, [newMessage, sending, currentAccount, token, conversationId]);

    const handleResolve = useCallback(async () => {
        setShowMenu(false);
        if (!currentAccount || !token) return;
        try {
            await fetch(`/api/chat/${conversationId}`, {
                method: 'PUT',
                headers: buildHeaders(token, currentAccount.id, true),
                body: JSON.stringify({ status: 'CLOSED' }),
            });
            return true; // Signal navigation to caller
        } catch (error) {
            Logger.error('[MobileChat] Resolve error:', { error });
            return false;
        }
    }, [currentAccount, token, conversationId]);

    const handleBlock = useCallback(async () => {
        setShowMenu(false);
        if (!currentAccount || !token || !conversationId) return;
        try {
            await fetch(`/api/chat/${conversationId}/block`, {
                method: 'POST',
                headers: buildHeaders(token, currentAccount.id, true),
                body: JSON.stringify({ reason: 'Blocked from mobile' }),
            });
            return true; // Signal navigation to caller
        } catch (error) {
            Logger.error('[MobileChat] Block error:', { error });
            return false;
        }
    }, [currentAccount, token, conversationId]);

    const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentAccount || !token) return;

        setIsUploading(true);
        haptic();

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch(`/api/chat/${conversationId}/attachments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                },
                body: formData,
            });

            if (res.ok) {
                const { url, filename } = await res.json();
                const attachmentMsg = `📎 [${filename}](${url})`;
                setNewMessage(prev => prev ? `${prev}\n${attachmentMsg}` : attachmentMsg);
                inputRef.current?.focus();
            }
        } catch (error) {
            Logger.error('[MobileChat] Upload error:', { error });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [currentAccount, token, conversationId]);

    const handleGenerateAIDraft = useCallback(async () => {
        if (!currentAccount || !token || isGeneratingDraft) return;

        setIsGeneratingDraft(true);
        haptic();

        try {
            const res = await fetch(`/api/chat/${conversationId}/ai-draft`, {
                method: 'POST',
                headers: buildHeaders(token, currentAccount.id, true),
                body: JSON.stringify({ currentDraft: newMessage || '' }),
            });

            if (res.ok) {
                const { draft } = await res.json();
                setNewMessage(draft);
                inputRef.current?.focus();
            }
        } catch (error) {
            Logger.error('[MobileChat] AI draft error:', { error });
        } finally {
            setIsGeneratingDraft(false);
        }
    }, [currentAccount, token, isGeneratingDraft, conversationId, newMessage]);

    // -------------------------------------------------------
    // Input helpers
    // -------------------------------------------------------

    const handleInputChange = useCallback((value: string) => {
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

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // -------------------------------------------------------
    // Effects
    // -------------------------------------------------------

    useEffect(() => {
        fetchConversation();
        const handleRefresh = () => fetchConversation();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [fetchConversation]);

    useEffect(() => {
        scrollToBottom();
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

        // Refs
        messagesEndRef,
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
