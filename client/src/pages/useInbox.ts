/**
 * useInbox — encapsulates all state, data-fetching, and mutation logic
 * for the Inbox page.
 *
 * Why: InboxPage was a 600-line god-component with 8+ inline fetch calls
 * all repeating auth headers. This hook extracts that logic so the page
 * component is purely presentational.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
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
import { useSearchParams } from 'react-router-dom';
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
    const messagesById = new Map(current.map(message => [message.id, message]));
    fetched.forEach(message => messagesById.set(message.id, message));
    return [...messagesById.values()].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

interface ConversationResponse extends InboxConversation {
    hasMoreMessages?: boolean;
    nextMessageCursor?: string | null;
}

export function useInbox() {
    const { socket, isConnected } = useSocket();
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedConversationId = searchParams.get('conversationId');

    // --- Core state ---
    const [conversations, setConversations] = useState<InboxConversation[]>([]);
    const [selectedId, setSelectedIdState] = useState<string | null>(requestedConversationId);
    const [messages, setMessages] = useState<InboxMessage[]>([]);
    const [hasMoreMessages, setHasMoreMessages] = useState(false);
    const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
    const [availableChannels, setAvailableChannels] = useState<AvailableChannelOption[]>([]);
    const [conversationFilter, setConversationFilter] = useState<ConversationFilterType>('all');
    const [showResolved, setShowResolved] = useState(false);
    const [listRevision, setListRevision] = useState(0);

    // Pagination
    const [hasMore, setHasMore] = useState(false);
    const [nextConversationCursor, setNextConversationCursor] = useState<string | null>(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Caches / refs
    const messagesCache = useRef<Map<string, InboxMessage[]>>(new Map());
    const conversationRequestsRef = useRef<Map<string, Promise<ConversationResponse | null>>>(new Map());
    const messagePaginationCache = useRef<Map<string, { hasMore: boolean; cursor: string | null }>>(new Map());
    const listRequestRef = useRef<AbortController | null>(null);
    const listRequestSequenceRef = useRef(0);
    const selectionRequestRef = useRef<AbortController | null>(null);
    const selectionSequenceRef = useRef(0);
    const olderMessagesRequestRef = useRef<AbortController | null>(null);
    const olderMessagesSequenceRef = useRef(0);
    const accountIdRef = useRef(currentAccount?.id);
    const selectedIdRef = useRef(selectedId);
    const initialLoadCompleteRef = useRef(false);
    accountIdRef.current = currentAccount?.id;

    const setSelectedId = useCallback((conversationId: string | null) => {
        selectedIdRef.current = conversationId;
        setSelectedIdState(conversationId);
        setSearchParams(previous => {
            const next = new URLSearchParams(previous);
            if (conversationId) next.set('conversationId', conversationId);
            else next.delete('conversationId');
            return next;
        }, { replace: true });
    }, [setSearchParams]);

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
            if (requestSequence !== listRequestSequenceRef.current || accountIdRef.current !== currentAccount.id) return;
            const parsed = Array.isArray(data)
                ? { conversations: data as InboxConversation[], hasMore: false, nextCursor: null }
                : {
                    conversations: ((data as { conversations?: InboxConversation[] }).conversations || []),
                    hasMore: Boolean((data as { hasMore?: unknown }).hasMore),
                    nextCursor: typeof (data as { nextCursor?: unknown }).nextCursor === 'string'
                        ? (data as { nextCursor: string }).nextCursor
                        : null,
                };

            const newConversations = parsed.conversations;
            setHasMore(parsed.hasMore);
            setNextConversationCursor(parsed.nextCursor);

            if (isLoadMore) {
                setConversations(previous => {
                    const knownIds = new Set(previous.map(conversation => conversation.id));
                    return [...previous, ...newConversations.filter(conversation => !knownIds.has(conversation.id))];
                });
            } else {
                setConversations(previous => {
                    const selected = previous.find(conversation => conversation.id === selectedIdRef.current);
                    return selected && !newConversations.some(conversation => conversation.id === selected.id)
                        ? [selected, ...newConversations]
                        : newConversations;
                });
            }

            if (isInitialLoad) {
                initialLoadCompleteRef.current = true;
            }
            setListRevision(revision => revision + 1);
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
        if (isLoadingMore || !hasMore || !nextConversationCursor) return;
        fetchConversations(nextConversationCursor);
    }, [isLoadingMore, hasMore, nextConversationCursor, fetchConversations]);

    // -------------------------------------------------------
    // Preload messages on hover
    // -------------------------------------------------------

    const handlePreloadConversation = useCallback((conversationId: string) => {
        if (messagesCache.current.has(conversationId) || conversationRequestsRef.current.has(conversationId)) return;
        if (!token || !currentAccount) return;
        const requestAccountId = currentAccount.id;

        const request: Promise<ConversationResponse | null> = fetch(`/api/chat/${conversationId}?limit=100`, {
            headers: buildHeaders(token, requestAccountId),
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.messages && accountIdRef.current === requestAccountId) {
                    messagesCache.current.set(conversationId, data.messages);
                    messagePaginationCache.current.set(conversationId, {
                        hasMore: Boolean(data.hasMoreMessages),
                        cursor: typeof data.nextMessageCursor === 'string' ? data.nextMessageCursor : null,
                    });
                    if (messagesCache.current.size > 25) {
                        const firstKey = messagesCache.current.keys().next().value;
                        if (firstKey) messagesCache.current.delete(firstKey);
                    }
                }
                return data as ConversationResponse | null;
            })
            .catch(() => null)
            .finally(() => {
                if (conversationRequestsRef.current.get(conversationId) === request) {
                    conversationRequestsRef.current.delete(conversationId);
                }
            });
        conversationRequestsRef.current.set(conversationId, request);
    }, [token, currentAccount]);

    const loadOlderMessages = useCallback(async () => {
        if (!selectedId || !token || !currentAccount || isLoadingOlderMessages) return;
        const pagination = messagePaginationCache.current.get(selectedId);
        if (!pagination?.hasMore || !pagination.cursor) return;

        olderMessagesRequestRef.current?.abort();
        const controller = new AbortController();
        olderMessagesRequestRef.current = controller;
        const requestSequence = ++olderMessagesSequenceRef.current;
        const conversationId = selectedId;
        const accountId = currentAccount.id;
        setIsLoadingOlderMessages(true);

        try {
            const params = new URLSearchParams({ limit: '100', before: pagination.cursor });
            const response = await fetch(`/api/chat/${conversationId}?${params}`, {
                headers: buildHeaders(token, accountId),
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Failed to load older messages (${response.status})`);
            const data = await response.json() as ConversationResponse;
            if (
                controller.signal.aborted ||
                requestSequence !== olderMessagesSequenceRef.current ||
                selectedIdRef.current !== conversationId ||
                accountIdRef.current !== accountId
            ) return;

            const olderMessages = Array.isArray(data.messages) ? data.messages : [];
            setMessages(previous => {
                const merged = mergeMessages(previous, olderMessages);
                messagesCache.current.set(conversationId, merged);
                return areMessagesEquivalent(previous, merged) ? previous : merged;
            });
            const nextPagination = {
                hasMore: Boolean(data.hasMoreMessages),
                cursor: typeof data.nextMessageCursor === 'string' ? data.nextMessageCursor : null,
            };
            messagePaginationCache.current.set(conversationId, nextPagination);
            setHasMoreMessages(nextPagination.hasMore);
        } catch (error) {
            if (!controller.signal.aborted) Logger.error('Failed to load older messages', { error, conversationId });
        } finally {
            if (requestSequence === olderMessagesSequenceRef.current) {
                setIsLoadingOlderMessages(false);
                olderMessagesRequestRef.current = null;
            }
        }
    }, [currentAccount, isLoadingOlderMessages, selectedId, token]);

    // -------------------------------------------------------
    // Conversation actions (all share the fetch→PUT→setState pattern)
    // -------------------------------------------------------

    /** Generic PUT update for the selected conversation */
    const patchConversation = useCallback(async (body: Record<string, unknown>) => {
        if (!selectedId || !token || !currentAccount) return false;
        const conversationId = selectedId;
        const accountId = currentAccount.id;
        const res = await fetch(`/api/chat/${conversationId}`, {
            method: 'PUT',
            headers: buildHeaders(token, accountId, true),
            body: JSON.stringify(body),
        });
        return res.ok && selectedIdRef.current === conversationId && accountIdRef.current === accountId;
    }, [selectedId, token, currentAccount]);

    /** Remove a conversation that no longer belongs in the current inbox view. */
    const dismissConversation = useCallback((conversationId: string) => {
        selectionRequestRef.current?.abort();
        olderMessagesRequestRef.current?.abort();
        selectionSequenceRef.current += 1;
        messagesCache.current.delete(conversationId);
        messagePaginationCache.current.delete(conversationId);
        conversationRequestsRef.current.delete(conversationId);
        setConversations(previous => previous.filter(conversation => conversation.id !== conversationId));

        if (selectedIdRef.current === conversationId) {
            setSelectedId(null);
            setMessages([]);
            setHasMoreMessages(false);
            setIsLoadingOlderMessages(false);
            setAvailableChannels([]);
        }
    }, [setSelectedId]);

    const handleStatusChange = useCallback(async (newStatus: string, snoozeUntil?: Date) => {
        const conversationId = selectedId;
        let ok: boolean;
        if (newStatus === 'SNOOZED' && snoozeUntil && selectedId && token && currentAccount) {
            const accountId = currentAccount.id;
            const res = await fetch(`/api/chat/${selectedId}/snooze`, {
                method: 'POST',
                headers: buildHeaders(token, currentAccount.id, true),
                body: JSON.stringify({ until: snoozeUntil.toISOString() }),
            });
            ok = res.ok && selectedIdRef.current === selectedId && accountIdRef.current === accountId;
        } else {
            ok = await patchConversation({ status: newStatus });
        }
        if (ok) {
            if (conversationId && newStatus !== 'OPEN' && !showResolved) {
                dismissConversation(conversationId);
            } else if (conversationId) {
                setConversations(previous => previous.map(conversation =>
                    conversation.id === conversationId
                        ? { ...conversation, status: newStatus }
                        : conversation
                ));
            }
            await fetchConversations();
        }
    }, [currentAccount, dismissConversation, fetchConversations, patchConversation, selectedId, showResolved, token]);

    const handleAssign = useCallback(async (userId: string) => {
        const ok = await patchConversation({ assignedTo: userId || null });
        if (ok) {
            await fetchConversations();
        }
    }, [fetchConversations, patchConversation]);

    const handleMerge = useCallback(async (targetConversationId: string) => {
        if (!selectedId || !token || !currentAccount) return;
        const targetId = selectedId;
        const accountId = currentAccount.id;
        const res = await fetch(`/api/chat/${targetId}/merge`, {
            method: 'POST',
            headers: buildHeaders(token, accountId, true),
            body: JSON.stringify({ sourceId: targetConversationId }),
        });
        if (res.ok && selectedIdRef.current === targetId && accountIdRef.current === accountId) await fetchConversations();
    }, [selectedId, token, currentAccount, fetchConversations]);

    const handleBlock = useMemo(() => {
        if (!recipientEmail) return undefined;
        return async () => {
            if (!selectedId || !token || !currentAccount) return;
            const conversationId = selectedId;
            const accountId = currentAccount.id;
            const res = await fetch(`/api/chat/${conversationId}/block`, {
                method: 'POST',
                headers: buildHeaders(token, currentAccount.id, true),
                body: JSON.stringify({ reason: 'Blocked from inbox' }),
            });
            if (selectedIdRef.current !== conversationId || accountIdRef.current !== accountId) return;
            if (res.ok) {
                dismissConversation(conversationId);
                await fetchConversations();
            } else {
                Logger.warn('Failed to block contact', { email: recipientEmail });
            }
        };
    }, [dismissConversation, fetchConversations, recipientEmail, selectedId, token, currentAccount]);

    const updateConversationStatus = useCallback(async (status: 'OPEN' | 'CLOSED') => {
        try {
            const conversationId = selectedId;
            const ok = await patchConversation({ status });
            if (ok) {
                if (conversationId && status !== 'OPEN' && !showResolved) {
                    dismissConversation(conversationId);
                } else if (conversationId) {
                    setConversations(previous => previous.map(conversation =>
                        conversation.id === conversationId ? { ...conversation, status } : conversation
                    ));
                }
                await fetchConversations();
            }
        } catch (e) {
            Logger.error('Failed to update status', { error: e });
        }
    }, [dismissConversation, fetchConversations, patchConversation, selectedId, showResolved]);

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
        persistedMessage?: InboxMessage,
    ) => {
        if (!selectedId || !token || !currentAccount) return;
        const conversationId = selectedId;
        const accountId = currentAccount.id;
        const upsertMessage = (created: InboxMessage) => {
            const cached = messagesCache.current.get(conversationId) || [];
            const cachedIndex = cached.findIndex(message =>
                message.id === created.id || Boolean(created.clientRequestId && message.clientRequestId === created.clientRequestId)
            );
            const updatedCache = cachedIndex >= 0
                ? cached.map((message, index) => index === cachedIndex ? { ...message, ...created } : message)
                : [...cached, created];
            messagesCache.current.set(conversationId, updatedCache);

            if (selectedIdRef.current !== conversationId || accountIdRef.current !== accountId) return;
            setMessages(previous => {
                const index = previous.findIndex(message =>
                    message.id === created.id || Boolean(created.clientRequestId && message.clientRequestId === created.clientRequestId)
                );
                return index >= 0
                    ? previous.map((message, messageIndex) => messageIndex === index ? { ...message, ...created } : message)
                    : [...previous, created];
            });
        };
        if (persistedMessage) {
            upsertMessage(persistedMessage);
            return;
        }
        try {
            const res = await fetch(`/api/chat/${conversationId}/messages`, {
                method: 'POST',
                headers: buildHeaders(token, accountId, true),
                body: JSON.stringify({ content, type, isInternal, channel, emailAccountId, clientRequestId }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string; message?: InboxMessage };
                if (data.message) upsertMessage(data.message);
                throw new Error(data.error || 'Failed to send message');
            }
            const created = await res.json() as InboxMessage;
            upsertMessage(created);
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
    useLayoutEffect(() => {
        initialLoadCompleteRef.current = false;
        listRequestRef.current?.abort();
        selectionRequestRef.current?.abort();
        olderMessagesRequestRef.current?.abort();
        listRequestSequenceRef.current += 1;
        selectionSequenceRef.current += 1;
        olderMessagesSequenceRef.current += 1;
        messagesCache.current.clear();
        messagePaginationCache.current.clear();
        conversationRequestsRef.current.clear();
        selectedIdRef.current = null;
        setSelectedIdState(null);
        setConversations([]);
        setMessages([]);
        setHasMoreMessages(false);
        setHasMore(false);
        setNextConversationCursor(null);
        setIsLoadingMore(false);
        setIsLoadingOlderMessages(false);
        setAvailableChannels([]);
        setIsComposeOpen(false);
        setHasMore(false);
        setIsLoadingMore(false);
        setIsLoading(Boolean(currentAccount?.id && token));
    }, [currentAccount?.id, token]);

    // Keep browser history/query-string navigation and local selection in sync.
    // The normal selection loader below hydrates deep-linked resolved conversations.
    useEffect(() => {
        selectedIdRef.current = requestedConversationId;
        setSelectedIdState(requestedConversationId);
    }, [currentAccount?.id, requestedConversationId]);

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
        olderMessagesRequestRef.current?.abort();
        olderMessagesSequenceRef.current += 1;
        const controller = new AbortController();
        selectionRequestRef.current = controller;
        const requestSequence = ++selectionSequenceRef.current;
        const requestAccountId = currentAccount.id;
        const cachedMessages = messagesCache.current.get(selectedId);
        const cachedPagination = messagePaginationCache.current.get(selectedId);
        setMessages(cachedMessages || []);
        setHasMoreMessages(cachedPagination?.hasMore || false);
        setIsLoadingOlderMessages(false);
        setAvailableChannels([]);

        const fetchConversationData = async () => {
            const headers = buildHeaders(token, currentAccount.id);
            const existingConversationRequest = conversationRequestsRef.current.get(selectedId);
            const messagesRequest = existingConversationRequest || fetch(`/api/chat/${selectedId}?limit=100`, {
                headers,
                signal: controller.signal,
            }).then(async response => {
                if (response.status === 403 || response.status === 404) return { unavailable: true };
                return response.ok ? response.json() : null;
            });

            const [conversationData, , channelsRes] = await Promise.all([
                messagesRequest,
                fetch(`/api/chat/${selectedId}/read`, { method: 'POST', headers, signal: controller.signal })
                    .catch(err => Logger.error('Failed to mark as read', { error: err })),
                fetch(`/api/chat/${selectedId}/available-channels`, { headers, signal: controller.signal })
                    .catch(() => null),
            ]);
            if (controller.signal.aborted || requestSequence !== selectionSequenceRef.current || accountIdRef.current !== requestAccountId) return;

            if ((conversationData as { unavailable?: boolean } | null)?.unavailable) {
                setSelectedId(null);
                setMessages([]);
                return;
            }

            if (conversationData) {
                const loadedConversation = conversationData as InboxConversation;
                setConversations(previous => previous.some(item => item.id === selectedId)
                    ? previous.map(item => item.id === selectedId ? { ...item, ...loadedConversation } : item)
                    : [loadedConversation, ...previous]);
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
                const pagination = {
                    hasMore: Boolean((conversationData as ConversationResponse).hasMoreMessages),
                    cursor: typeof (conversationData as ConversationResponse).nextMessageCursor === 'string'
                        ? (conversationData as ConversationResponse).nextMessageCursor as string
                        : null,
                };
                messagePaginationCache.current.set(selectedId, pagination);
                setHasMoreMessages(pagination.hasMore);
            }

            setConversations(prev => prev.map(c =>
                c.id === selectedId ? { ...c, isRead: true } : c
            ));

            if (channelsRes?.ok) {
                const data: unknown = await channelsRes.json();
                if (controller.signal.aborted || requestSequence !== selectionSequenceRef.current || accountIdRef.current !== requestAccountId) return;
                setAvailableChannels((data as { channels?: AvailableChannelOption[] }).channels || []);
            } else {
                setAvailableChannels([]);
            }
        };

        void fetchConversationData().catch(error => {
            if (!controller.signal.aborted) Logger.error('Failed to load conversation', { error, conversationId: selectedId });
        });

        return () => controller.abort();
    }, [selectedId, token, currentAccount, setSelectedId]);

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
        hasMoreMessages,
        isLoadingOlderMessages,
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
        listRevision,

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
        loadOlderMessages,
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
