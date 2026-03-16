/**
 * useInboxSocket — handles all socket event listeners for the inbox.
 *
 * Why: extracted from useInbox (474 lines) to keep files under the 200-line
 * limit and isolate real-time event handling from the rest of the inbox logic.
 */

import { useEffect, startTransition, type MutableRefObject } from 'react';
import { Logger } from '../utils/logger';
import type { Socket } from 'socket.io-client';

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
    messagesCache: MutableRefObject<Map<string, any[]>>;
    setConversations: React.Dispatch<React.SetStateAction<any[]>>;
    setMessages: React.Dispatch<React.SetStateAction<any[]>>;
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
                    // Why: conversation:updated can also append this message via lastMessage,
                    // causing duplicates. Guard against it here.
                    if (prev.find(m => m.id === msg.id)) return prev;
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
    }, [socket, selectedId, accountId, token, messagesCache, setConversations, setMessages]);
}
