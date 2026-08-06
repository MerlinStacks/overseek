/**
 * useInbox — encapsulates all state, data-fetching, and mutation logic
 * for the Inbox page.
 *
 * Why: InboxPage was a 600-line god-component with 8+ inline fetch calls
 * all repeating auth headers. This hook extracts that logic so the page
 * component is purely presentational.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Logger } from '../utils/logger';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useCannedResponses } from '../hooks/useCannedResponses';
import { useEmailAccounts } from '../hooks/useEmailAccounts';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useInboxSocket } from '../hooks/useInboxSocket';
import type { ConversationChannel } from '../components/chat/ChannelSelector';
import type { AvailableChannelOption, InboxConversation, InboxMessage } from '../types/inbox';
type ConversationFilterType = 'all' | 'mine' | 'unassigned';

/** Shared auth headers builder — eliminates per-fetch boilerplate */
function buildHeaders(token: string, accountId: string, json = false) {
    const h: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'x-account-id': accountId,
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

function areMessagesEquivalent(current: InboxMessage[], next: InboxMessage[]) {
    if (current.length !== next.length) return false;

    return current.every((message, index) => {
        const nextMessage = next[index];
        return nextMessage &&
            message.id === nextMessage.id &&
            message.content === nextMessage.content &&
            message.createdAt === nextMessage.createdAt &&
            message.status === nextMessage.status &&
            message.readAt === nextMessage.readAt &&
            message.firstOpenedAt === nextMessage.firstOpenedAt &&
            message.openCount === nextMessage.openCount;
    });
}

function mergeMessages(current: InboxMessage[], fetched: InboxMessage[]) {
    const fetchedIds = new Set(fetched.map(message => message.id));
    const newerLocalMessages = current.filter(message => !fetchedIds.has(message.id));
    if (newerLocalMessages.length === 0) return fetched;

    return [...fetched, ...newerLocalMessages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

export function useInbox() {
    const { socket, isConnected } = useSocket();
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    // --- Core state ---
    const [conversations, setConversations] = useState<InboxConversation[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [messages, setMessages] = useState<InboxMessage[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
    const [availableChannels, setAvailableChannels] = useState<AvailableChannelOption[]>([]);
    const [conversationFilter, setConversationFilter] = useState<ConversationFilterType>('all');
    const [showResolved, setShowResolved] = useState(false);

    // Pagination
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Caches / refs
    const messagesCache = useRef<Map<string, InboxMessage[]>>(new Map());
    const conversationRequestsRef = useRef<Map<string, Promise<{ messages?: InboxMessage[] } | null>>>(new Map());
    const listRequestRef = useRef<AbortController | null>(null);
    const listRequestSequenceRef = useRef(0);
    const selectionRequestRef = useRef<AbortController | null>(null);
    const selectionSequenceRef = useRef(0);
    const accountIdRef = useRef(currentAccount?.id);
    const initialLoadCompleteRef = useRef(false);
    accountIdRef.current = currentAccount?.id;

    // Lifted hooks — persist across conversation switches
    const canned = useCannedResponses();
    const emailAccounts = useEmailAccounts();

    // --- Derived data ---
    const activeConversation = useMemo(
        () => conversations.find(c => c.id === selectedId),
        [conversations, selectedId]
    );

    const recipientEmail = useMemo(
        () => activeConversation?.wooCustomer?.email || activeConversation?.guestEmail,
        [activeConversation?.wooCustomer?.email, activeConversation?.guestEmail]
    );

    const recipientName = useMemo(
        () => activeConversation?.wooCustomer
            ? `${activeConversation.wooCustomer.firstName || ''} ${activeConversation.wooCustomer.lastName || ''}`.trim()
            : activeConversation?.guestName,
        [activeConversation?.wooCustomer, activeConversation?.guestName]
    );

    const customerData = useMemo(() => {
        if (activeConversation?.wooCustomer) {
            return {
                firstName: activeConversation.wooCustomer.firstName,
                lastName: activeConversation.wooCustomer.lastName,
                email: activeConversation.wooCustomer.email,
                ordersCount: activeConversation.wooCustomer.ordersCount,
                totalSpent: activeConversation.wooCustomer.totalSpent,
                wooId: activeConversation.wooCustomer.wooId,
            };
        }
        return {
            firstName: activeConversation?.guestName?.split(' ')[0],
            lastName: activeConversation?.guestName?.split(' ').slice(1).join(' '),
            email: activeConversation?.guestEmail,
        };
    }, [activeConversation?.wooCustomer, activeConversation?.guestName, activeConversation?.guestEmail]);

    // -------------------------------------------------------
    // Conversations list
    // -------------------------------------------------------

    const shouldIncludeConversation = useCallback((conversation: InboxConversation) => {
        if (!showResolved && conversation.status !== 'OPEN') return false;
        if (conversationFilter === 'mine') return conversation.assignedTo === user?.id;
        if (conversationFilter === 'unassigned') return !conversation.assignedTo;
        return true;
    }, [conversationFilter, showResolved, user?.id]);

    const fetchConversations = useCallback(async (cursor?: string) => {
        if (!currentAccount || !token) return;

        listRequestRef.current?.abort();
        const controller = new AbortController();
        listRequestRef.current = controller;
        const requestSequence = ++listRequestSequenceRef.current;
        const isLoadMore = !!cursor;
        const isInitialLoad = !initialLoadCompleteRef.current && !cursor;

        if (isLoadMore) {
            setIsLoadingMore(true);
        } else if (isInitialLoad) {
            setIsLoading(true);
        }

        try {
            const params = new URLSearchParams();
            params.set('limit', '50');
            params.set('sort', 'priority');
            if (cursor) params.set('cursor', cursor);
            if (!showResolved) params.set('status', 'OPEN');
            if (conversationFilter === 'mine' && user?.id) {
                params.set('assignedTo', user.id);
            } else if (conversationFilter === 'unassigned') {
                params.set('assignedTo', '__unassigned__');
            }

            const res = await fetch(`/api/chat/conversations?${params}`, {
                headers: buildHeaders(token, currentAccount.id),
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`Failed to load conversations (${res.status})`);
            const data: unknown = await res.json();
            if (requestSequence !== listRequestSequenceRef.current) return;
            const parsed = Array.isArray(data)
                ? { conversations: data as InboxConversation[], hasMore: false }
                : {
                    conversations: ((data as { conversations?: InboxConversation[] }).conversations || []),
                    hasMore: Boolean((data as { hasMore?: unknown }).hasMore),
                };

            const newConversations = parsed.conversations;
            setHasMore(parsed.hasMore);

            if (isLoadMore) {
                setConversations(prev => [...prev, ...newConversations]);
            } else {
                setConversations(newConversations);
            }

            if (isInitialLoad) {
                initialLoadCompleteRef.current = true;
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            Logger.error('Failed to load chats', { error });
        } finally {
            if (requestSequence === listRequestSequenceRef.current) {
                if (isInitialLoad) setIsLoading(false);
                setIsLoadingMore(false);
                listRequestRef.current = null;
            }
        }
    }, [conversationFilter, currentAccount, showResolved, token, user?.id]);

    const loadMoreConversations = useCallback(() => {
        if (isLoadingMore || !hasMore || conversations.length === 0) return;
        const lastConv = conversations[conversations.length - 1];
        if (lastConv?.id) fetchConversations(lastConv.id);
    }, [isLoadingMore, hasMore, conversations, fetchConversations]);

    // -------------------------------------------------------
    // Preload messages on hover
    // -------------------------------------------------------

    const handlePreloadConversation = useCallback((conversationId: string) => {
        if (messagesCache.current.has(conversationId) || conversationRequestsRef.current.has(conversationId)) return;
        if (!token || !currentAccount) return;
        const requestAccountId = currentAccount.id;

        const request = fetch(`/api/chat/${conversationId}`, {
            headers: buildHeaders(token, requestAccountId),
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.messages && accountIdRef.current === requestAccountId) {
                    messagesCache.current.set(conversationId, data.messages);
                    if (messagesCache.current.size > 25) {
                        const firstKey = messagesCache.current.keys().next().value;
                        if (firstKey) messagesCache.current.delete(firstKey);
                    }
                }
                return data as { messages?: InboxMessage[] } | null;
            })
            .catch(() => null)
            .finally(() => conversationRequestsRef.current.delete(conversationId));
        conversationRequestsRef.current.set(conversationId, request);
    }, [token, currentAccount]);

    // -------------------------------------------------------
    // Conversation actions (all share the fetch→PUT→setState pattern)
    // -------------------------------------------------------

    /** Generic PUT update for the selected conversation */
    const patchConversation = useCallback(async (body: Record<string, unknown>) => {
        if (!selectedId || !token || !currentAccount) return false;
        const res = await fetch(`/api/chat/${selectedId}`, {
            method: 'PUT',
            headers: buildHeaders(token, currentAccount.id, true),
            body: JSON.stringify(body),
        });
        return res.ok;
    }, [selectedId, token, currentAccount]);

    const handleStatusChange = useCallback(async (newStatus: string, snoozeUntil?: Date) => {
        let ok: boolean;
        if (newStatus === 'SNOOZED' && snoozeUntil && selectedId && token && currentAccount) {
            const res = await fetch(`/api/chat/${selectedId}/snooze`, {
                method: 'POST',
                headers: buildHeaders(token, currentAccount.id, true),
                body: JSON.stringify({ until: snoozeUntil.toISOString() }),
            });
            ok = res.ok;
        } else {
            ok = await patchConversation({ status: newStatus });
        }
        if (ok) {
            await fetchConversations();
        }
    }, [currentAccount, fetchConversations, patchConversation, selectedId, token]);

    const handleAssign = useCallback(async (userId: string) => {
        const ok = await patchConversation({ assignedTo: userId || null });
        if (ok) {
            await fetchConversations();
        }
    }, [fetchConversations, patchConversation]);

    const handleMerge = useCallback(async (targetConversationId: string) => {
        if (!selectedId || !token || !currentAccount) return;
        const res = await fetch(`/api/chat/${selectedId}/merge`, {
            method: 'POST',
            headers: buildHeaders(token, currentAccount.id, true),
            body: JSON.stringify({ sourceId: targetConversationId }),
        });
        if (res.ok) await fetchConversations();
    }, [selectedId, token, currentAccount, fetchConversations]);

    const handleBlock = useMemo(() => {
        if (!recipientEmail) return undefined;
        return async () => {
            if (!selectedId || !token || !currentAccount) return;
            const res = await fetch('/api/chat/block', {
                method: 'POST',
                headers: buildHeaders(token, currentAccount.id, true),
                body: JSON.stringify({ email: recipientEmail }),
            });
            if (res.ok) {
                await patchConversation({ status: 'CLOSED' });
                await fetchConversations();
            } else {
                Logger.warn('Failed to block contact', { email: recipientEmail });
            }
        };
    }, [fetchConversations, recipientEmail, selectedId, token, currentAccount, patchConversation]);

    const updateConversationStatus = useCallback(async (status: 'OPEN' | 'CLOSED') => {
        try {
            const ok = await patchConversation({ status });
            if (ok) {
                await fetchConversations();
            }
        } catch (e) {
            Logger.error('Failed to update status', { error: e });
        }
    }, [fetchConversations, patchConversation]);

    // -------------------------------------------------------
    // Send message
    // -------------------------------------------------------

    const handleSendMessage = useCallback(async (
        content: string,
        type: 'AGENT' | 'SYSTEM',
        isInternal: boolean,
        channel?: ConversationChannel,
        emailAccountId?: string,
        clientRequestId?: string,
    ) => {
        if (!selectedId) return;
        try {
            const res = await fetch(`/api/chat/${selectedId}/messages`, {
                method: 'POST',
                headers: buildHeaders(token!, currentAccount!.id, true),
                body: JSON.stringify({ content, type, isInternal, channel, emailAccountId, clientRequestId }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to send message');
            }
            const created = await res.json() as InboxMessage;
            setMessages(prev => {
                const duplicate = prev.some(m => m.id === created.id || (created.clientRequestId && m.clientRequestId === created.clientRequestId));
                if (duplicate) return prev;
                const updated = [...prev, created];
                messagesCache.current.set(selectedId, updated);
                return updated;
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.error('Failed to send message', { error: message });
            throw error;
        }
    }, [selectedId, token, currentAccount]);

    // -------------------------------------------------------
    // Effects
    // -------------------------------------------------------

    // Reset account-scoped state. The list effect below owns the initial fetch;
    // polling only handles subsequent interval/visibility refreshes.
    useEffect(() => {
        initialLoadCompleteRef.current = false;
        listRequestRef.current?.abort();
        selectionRequestRef.current?.abort();
        messagesCache.current.clear();
        conversationRequestsRef.current.clear();
        setSelectedId(null);
        setMessages([]);
        setAvailableChannels([]);
    }, [currentAccount?.id]);

    // Visibility-based polling fallback
    useVisibilityPolling(() => fetchConversations(), 30000, [fetchConversations], 'inbox-conversations', false);

    // Socket listeners (extracted to reduce file size)
    useInboxSocket({
        socket,
        selectedId,
        token,
        accountId: currentAccount?.id,
        messagesCache,
        shouldIncludeConversation,
        setConversations,
        setMessages,
    });

    useEffect(() => {
        // Refetch immediately when server-side list filters change.
        fetchConversations();
    }, [fetchConversations]);

    // Fetch messages when a conversation is selected
    useEffect(() => {
        if (!selectedId || !token || !currentAccount) return;

        selectionRequestRef.current?.abort();
        const controller = new AbortController();
        selectionRequestRef.current = controller;
        const requestSequence = ++selectionSequenceRef.current;
        const cachedMessages = messagesCache.current.get(selectedId);
        setMessages(cachedMessages || []);
        setAvailableChannels([]);

        const fetchConversationData = async () => {
            const headers = buildHeaders(token, currentAccount.id);
            const existingConversationRequest = conversationRequestsRef.current.get(selectedId);
            const messagesRequest = existingConversationRequest || fetch(`/api/chat/${selectedId}`, {
                headers,
                signal: controller.signal,
            }).then(async response => response.ok ? response.json() : null);

            const [conversationData, , channelsRes] = await Promise.all([
                messagesRequest,
                fetch(`/api/chat/${selectedId}/read`, { method: 'POST', headers, signal: controller.signal })
                    .catch(err => Logger.error('Failed to mark as read', { error: err })),
                fetch(`/api/chat/${selectedId}/available-channels`, { headers, signal: controller.signal })
                    .catch(() => null),
            ]);
            if (controller.signal.aborted || requestSequence !== selectionSequenceRef.current) return;

            if (conversationData) {
                const nextMessages = (conversationData as { messages?: InboxMessage[] }).messages;
                if (nextMessages) {
                    setMessages(prev => {
                        const mergedMessages = mergeMessages(prev, nextMessages);
                        if (areMessagesEquivalent(prev, mergedMessages)) return prev;
                        messagesCache.current.set(selectedId, mergedMessages);
                        return mergedMessages;
                    });
                    if (messagesCache.current.size > 20) {
                        const firstKey = messagesCache.current.keys().next().value;
                        if (firstKey) messagesCache.current.delete(firstKey);
                    }
                }
            }

            setConversations(prev => prev.map(c =>
                c.id === selectedId ? { ...c, isRead: true } : c
            ));

            if (channelsRes?.ok) {
                const data: unknown = await channelsRes.json();
                setAvailableChannels((data as { channels?: AvailableChannelOption[] }).channels || []);
            } else {
                setAvailableChannels([]);
            }
        };

        void fetchConversationData().catch(error => {
            if (!controller.signal.aborted) Logger.error('Failed to load conversation', { error, conversationId: selectedId });
        });

        return () => controller.abort();
    }, [selectedId, token, currentAccount]);

    // Keyboard shortcuts
    useKeyboardShortcuts({
        conversations,
        selectedId,
        onSelect: setSelectedId,
        onClose: () => updateConversationStatus('CLOSED'),
        onReopen: () => updateConversationStatus('OPEN'),
        onShowHelp: () => setIsShortcutsHelpOpen(true),
        enabled: !isComposeOpen && !isShortcutsHelpOpen,
    });

    // -------------------------------------------------------
    // Public API
    // -------------------------------------------------------

    return {
        // State
        conversations,
        selectedId,
        setSelectedId,
        messages,
        isLoading,
        isComposeOpen,
        setIsComposeOpen,
        isShortcutsHelpOpen,
        setIsShortcutsHelpOpen,
        availableChannels,
        conversationFilter,
        setConversationFilter,
        showResolved,
        setShowResolved,
        hasMore,
        isLoadingMore,

        // Derived
        activeConversation,
        recipientEmail,
        recipientName,
        customerData,
        user,
        isConnected,

        // Actions
        fetchConversations,
        loadMoreConversations,
        handlePreloadConversation,
        handleSendMessage,
        handleStatusChange,
        handleAssign,
        handleMerge,
        handleBlock,

        // Lifted hooks
        canned,
        emailAccounts,
    };
}
