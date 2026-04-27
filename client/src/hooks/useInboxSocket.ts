/**
 * useInboxSocket — handles all socket event listeners for the inbox.
 *
 * Why: extracted from useInbox (474 lines) to keep files under the 200-line
 * limit and isolate real-time event handling from the rest of the inbox logic.
 */

import { useEffect, startTransition, type MutableRefObject } from 'react';
import { Logger } from '../utils/logger';
import type { Socket } from 'socket.io-client';
import type { InboxConversation, InboxMessage } from '../types/inbox';

/** Shared auth headers builder — mirrors useInbox */
function buildHeaders(token: string, accountId: string) {
    return {
        'Authorization': `Bearer ${token}`,
        'x-account-id': accountId,
    };
}

interface UseInboxSocketParams {
    socket: Socket | null;
    selectedId: string | null;
    token: string | null;
    accountId: string | undefined;
    messagesCache: MutableRefObject<Map<string, InboxMessage[]>>;
    shouldIncludeConversation: (conversation: InboxConversation) => boolean;
    setConversations: React.Dispatch<React.SetStateAction<InboxConversation[]>>;
    setMessages: React.Dispatch<React.SetStateAction<InboxMessage[]>>;
}

interface ConversationUpdatedPayload {
    id: string;
    lastMessage?: InboxMessage;
    updatedAt: string;
}

/**
 * Attaches socket listeners for conversation:updated, conversation:read,
 * and message:new events. Handles deduplication, cache updates, and
 * fetching newly-created conversations.
 */
export function useInboxSocket({
    socket,
    selectedId,
    token,
    accountId,
    messagesCache,
    shouldIncludeConversation,
    setConversations,
    setMessages,
}: UseInboxSocketParams) {
    useEffect(() => {
        if (!socket || !accountId || !token) return;

        /**
         * Fetches a full conversation object when we receive an update
         * for a conversation not yet in our local list (e.g., new incoming).
         */
        const fetchNewConversation = async (id: string) => {
            try {
                const res = await fetch(`/api/chat/${id}`, {
                    headers: buildHeaders(token, accountId),
                });
                if (res.ok) {
                    const newConv = await res.json() as InboxConversation;
                    if (!shouldIncludeConversation(newConv)) return;
                    setConversations(prev => {
                        if (prev.find(c => c.id === id)) return prev;
                        return [newConv, ...prev];
                    });
                }
            } catch (error) {
                Logger.error('Failed to fetch new conversation', { error });
            }
        };

        socket.on('conversation:updated', async (data: ConversationUpdatedPayload) => {
            let needsFetch = false;
            const lastMessage = data.lastMessage;
            startTransition(() => {
                setConversations(prev => {
                    const idx = prev.findIndex(c => c.id === data.id);
                    if (idx === -1) {
                        // Why flag instead of calling here: startTransition only wraps
                        // synchronous updates. An async fetch completes after the
                        // transition boundary, so its setConversations would run outside it.
                        needsFetch = true;
                        return prev;
                    }
                    const updated = [...prev];
                    updated[idx] = {
                        ...updated[idx],
                        messages: lastMessage ? [lastMessage] : updated[idx].messages,
                        updatedAt: data.updatedAt,
                        isRead: selectedId === data.id,
                    };
                    return updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                });
            });
            if (needsFetch) fetchNewConversation(data.id);

            if (selectedId === data.id && lastMessage) {
                setMessages(prev => {
                    if (prev.find(m => m.id === lastMessage.id)) return prev;
                    return [...prev, lastMessage];
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

        socket.on('message:new', (msg: InboxMessage) => {
            const conversationId = msg.conversationId;
            if (!conversationId) return;
            if (selectedId === conversationId) {
                setMessages(prev => {
                    // Why: conversation:updated can also append this message via lastMessage,
                    // causing duplicates. Guard against it here.
                    if (prev.find(m => m.id === msg.id)) return prev;
                    const updated = [...prev, msg];
                    messagesCache.current.set(conversationId, updated);
                    return updated;
                });
            } else {
                const cached = messagesCache.current.get(conversationId);
                if (cached) {
                    messagesCache.current.set(conversationId, [...cached, msg]);
                }
            }
        });

        return () => {
            socket.off('conversation:updated');
            socket.off('conversation:read');
            socket.off('message:new');
        };
    }, [socket, selectedId, accountId, token, messagesCache, shouldIncludeConversation, setConversations, setMessages]);
}
