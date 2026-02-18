/**
 * useInbox — encapsulates all state, data-fetching, and mutation logic
 * for the Inbox page.
 *
 * Why: InboxPage was a 600-line god-component with 8+ inline fetch calls
 * all repeating auth headers. This hook extracts that logic so the page
 * component is purely presentational.
 */

import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import { Logger } from '../utils/logger';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useCannedResponses } from '../hooks/useCannedResponses';
import { useEmailAccounts } from '../hooks/useEmailAccounts';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { ConversationChannel } from '../components/chat/ChannelSelector';

/** Shared auth headers builder — eliminates per-fetch boilerplate */
function buildHeaders(token: string, accountId: string, json = false) {
    const h: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'x-account-id': accountId,
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

export function useInbox() {
    const { socket, isConnected } = useSocket();
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    // --- Core state ---
    const [conversations, setConversations] = useState<any[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
    const [availableChannels, setAvailableChannels] = useState<Array<{ channel: ConversationChannel; identifier: string; available: boolean }>>([]);

    // Pagination
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Caches / refs
    const messagesCache = useRef<Map<string, any[]>>(new Map());
    const preloadingRef = useRef<Set<string>>(new Set());
    const initialLoadCompleteRef = useRef(false);

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

    const fetchConversations = useCallback(async (cursor?: string) => {
        if (!currentAccount || !token) return;

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
            if (cursor) params.set('cursor', cursor);

            const res = await fetch(`/api/chat/conversations?${params}`, {
                headers: buildHeaders(token, currentAccount.id),
            });
            const data = await res.json();

            const newConversations = data.conversations || data;
            setHasMore(data.hasMore ?? false);

            if (isLoadMore) {
                setConversations(prev => [...prev, ...newConversations]);
            } else {
                setConversations(newConversations);
            }

            if (isInitialLoad) {
                initialLoadCompleteRef.current = true;
            }
        } catch (error) {
            Logger.error('Failed to load chats', { error });
        } finally {
            if (isInitialLoad) setIsLoading(false);
            setIsLoadingMore(false);
        }
    }, [currentAccount, token]);

    const loadMoreConversations = useCallback(() => {
        if (isLoadingMore || !hasMore || conversations.length === 0) return;
        const lastConv = conversations[conversations.length - 1];
        if (lastConv?.id) fetchConversations(lastConv.id);
    }, [isLoadingMore, hasMore, conversations, fetchConversations]);

    // -------------------------------------------------------
    // Preload messages on hover
    // -------------------------------------------------------

    const handlePreloadConversation = useCallback((conversationId: string) => {
        if (messagesCache.current.has(conversationId) || preloadingRef.current.has(conversationId)) return;
        if (!token || !currentAccount) return;

        preloadingRef.current.add(conversationId);

        fetch(`/api/chat/${conversationId}`, {
            headers: buildHeaders(token, currentAccount.id),
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.messages) {
                    messagesCache.current.set(conversationId, data.messages);
                    if (messagesCache.current.size > 25) {
                        const firstKey = messagesCache.current.keys().next().value;
                        if (firstKey) messagesCache.current.delete(firstKey);
                    }
                }
            })
            .catch(() => { /* Silent fail for preload */ })
            .finally(() => preloadingRef.current.delete(conversationId));
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
        const ok = await patchConversation({
            status: newStatus,
            snoozeUntil: snoozeUntil?.toISOString(),
        });
        if (ok) {
            setConversations(prev => prev.map(c =>
                c.id === selectedId ? { ...c, status: newStatus } : c
            ));
        }
    }, [patchConversation, selectedId]);

    const handleAssign = useCallback(async (userId: string) => {
        const ok = await patchConversation({ assignedTo: userId || null });
        if (ok) {
            setConversations(prev => prev.map(c =>
                c.id === selectedId ? { ...c, assignedTo: userId || null } : c
            ));
        }
    }, [patchConversation, selectedId]);

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
                setConversations(prev => prev.map(c =>
                    c.id === selectedId ? { ...c, status: 'CLOSED' } : c
                ));
                alert('Contact blocked. Their future messages will be auto-resolved.');
            } else {
                alert('Failed to block contact');
            }
        };
    }, [recipientEmail, selectedId, token, currentAccount, patchConversation]);

    const updateConversationStatus = useCallback(async (status: 'OPEN' | 'CLOSED') => {
        try {
            const ok = await patchConversation({ status });
            if (ok) {
                setConversations(prev => prev.map(c =>
                    c.id === selectedId ? { ...c, status } : c
                ));
            }
        } catch (e) {
            Logger.error('Failed to update status', { error: e });
        }
    }, [patchConversation, selectedId]);

    // -------------------------------------------------------
    // Send message
    // -------------------------------------------------------

    const handleSendMessage = useCallback(async (
        content: string,
        type: 'AGENT' | 'SYSTEM',
        isInternal: boolean,
        channel?: ConversationChannel,
        emailAccountId?: string,
    ) => {
        if (!selectedId) return;
        try {
            const res = await fetch(`/api/chat/${selectedId}/messages`, {
                method: 'POST',
                headers: buildHeaders(token!, currentAccount!.id, true),
                body: JSON.stringify({ content, type, isInternal, channel, emailAccountId }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to send message');
            }
        } catch (error: any) {
            Logger.error('Failed to send message', { error: error?.message || error });
            alert(error?.message || 'Failed to send');
            throw error;
        }
    }, [selectedId, token, currentAccount]);

    // -------------------------------------------------------
    // Effects
    // -------------------------------------------------------

    // Reset initial-load flag when account changes.
    // useVisibilityPolling (below) handles the actual initial fetch on mount.
    useEffect(() => {
        initialLoadCompleteRef.current = false;
    }, [currentAccount?.id, token]);

    // Visibility-based polling fallback
    useVisibilityPolling(() => fetchConversations(), 30000, [fetchConversations], 'inbox-conversations');

    // Socket listeners
    useEffect(() => {
        if (!socket || !currentAccount || !token) return;

        const fetchNewConversation = async (id: string) => {
            if (!currentAccount) return;
            try {
                const res = await fetch(`/api/chat/${id}`, {
                    headers: buildHeaders(token, currentAccount.id),
                });
                if (res.ok) {
                    const newConv = await res.json();
                    setConversations(prev => {
                        if (prev.find(c => c.id === id)) return prev;
                        return [newConv, ...prev];
                    });
                }
            } catch (error) {
                Logger.error('Failed to fetch new conversation', { error });
            }
        };

        socket.on('conversation:updated', async (data: any) => {
            startTransition(() => {
                setConversations(prev => {
                    const idx = prev.findIndex(c => c.id === data.id);
                    if (idx === -1) {
                        fetchNewConversation(data.id);
                        return prev;
                    }
                    const updated = [...prev];
                    updated[idx] = {
                        ...updated[idx],
                        messages: [data.lastMessage],
                        updatedAt: data.updatedAt,
                        isRead: selectedId === data.id,
                    };
                    return updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                });
            });

            if (selectedId === data.id && data.lastMessage) {
                setMessages(prev => {
                    if (prev.find(m => m.id === data.lastMessage.id)) return prev;
                    return [...prev, data.lastMessage];
                });
            }
        });

        socket.on('conversation:read', (data: { id: string }) => {
            startTransition(() => {
                setConversations(prev => prev.map(c =>
                    c.id === data.id ? { ...c, isRead: true } : c
                ));
            });
        });

        socket.on('message:new', (msg: any) => {
            if (selectedId === msg.conversationId) {
                setMessages(prev => {
                    const updated = [...prev, msg];
                    messagesCache.current.set(msg.conversationId, updated);
                    return updated;
                });
            } else {
                const cached = messagesCache.current.get(msg.conversationId);
                if (cached) {
                    messagesCache.current.set(msg.conversationId, [...cached, msg]);
                }
            }
        });

        return () => {
            socket.off('conversation:updated');
            socket.off('conversation:read');
            socket.off('message:new');
        };
    }, [socket, selectedId, currentAccount, token]);

    // Fetch messages when a conversation is selected
    useEffect(() => {
        if (!selectedId || !token || !currentAccount) return;

        socket?.emit('join:conversation', selectedId);

        const cachedMessages = messagesCache.current.get(selectedId);
        if (cachedMessages) setMessages(cachedMessages);

        const fetchConversationData = async () => {
            const headers = buildHeaders(token, currentAccount.id);

            const [messagesRes, , channelsRes] = await Promise.all([
                fetch(`/api/chat/${selectedId}`, { headers }),
                fetch(`/api/chat/${selectedId}/read`, { method: 'POST', headers })
                    .catch(err => Logger.error('Failed to mark as read', { error: err })),
                fetch(`/api/chat/${selectedId}/available-channels`, { headers })
                    .catch(() => null),
            ]);

            if (messagesRes.ok) {
                const data = await messagesRes.json();
                if (data.messages) {
                    setMessages(data.messages);
                    messagesCache.current.set(selectedId, data.messages);
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
                const data = await channelsRes.json();
                setAvailableChannels(data.channels || []);
            } else {
                setAvailableChannels([]);
            }
        };

        fetchConversationData();

        return () => { socket?.emit('leave:conversation', selectedId); };
    }, [selectedId, token, socket, currentAccount]);

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
