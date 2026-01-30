
import { useState, useEffect, useRef, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { ConversationList } from '../components/chat/ConversationList';
import { ChatWindow } from '../components/chat/ChatWindow';
import { ContactPanel } from '../components/chat/ContactPanel';
import { NewEmailModal } from '../components/chat/NewEmailModal';
import { KeyboardShortcutsHelp } from '../components/chat/KeyboardShortcutsHelp';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { MessageSquare } from 'lucide-react';
import type { ConversationChannel } from '../components/chat/ChannelSelector';

export function InboxPage() {
    const { socket, isConnected } = useSocket();
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    const [conversations, setConversations] = useState<any[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
    const [availableChannels, setAvailableChannels] = useState<Array<{ channel: ConversationChannel; identifier: string; available: boolean }>>([]);

    // Cache for previously fetched messages - enables instant switching between conversations
    const messagesCache = useRef<Map<string, any[]>>(new Map());
    // Track pending preload requests to avoid duplicate fetches
    const preloadingRef = useRef<Set<string>>(new Set());

    /**
     * Preload messages when user hovers over a conversation.
     * Fetches messages in background and populates cache for instant switching.
     */
    const handlePreloadConversation = useCallback((conversationId: string) => {
        // Skip if already cached or currently preloading
        if (messagesCache.current.has(conversationId) || preloadingRef.current.has(conversationId)) {
            return;
        }
        if (!token || !currentAccount) return;

        preloadingRef.current.add(conversationId);

        // Fetch in background (low priority)
        fetch(`/api/chat/${conversationId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount.id
            }
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.messages) {
                    messagesCache.current.set(conversationId, data.messages);
                    // Keep cache bounded
                    if (messagesCache.current.size > 25) {
                        const firstKey = messagesCache.current.keys().next().value;
                        if (firstKey) messagesCache.current.delete(firstKey);
                    }
                }
            })
            .catch(() => { /* Silent fail for preload */ })
            .finally(() => {
                preloadingRef.current.delete(conversationId);
            });
    }, [token, currentAccount]);

    const activeConversation = conversations.find(c => c.id === selectedId);

    // Get recipient info for ChatWindow
    const recipientEmail = activeConversation?.wooCustomer?.email || activeConversation?.guestEmail;
    const recipientName = activeConversation?.wooCustomer
        ? `${activeConversation.wooCustomer.firstName || ''} ${activeConversation.wooCustomer.lastName || ''}`.trim()
        : activeConversation?.guestName;

    /**
     * Fetch conversations list from API.
     * Used for initial load and visibility-based polling fallback.
     */
    const fetchConversations = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch('/api/chat/conversations', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            const data = await res.json();
            setConversations(data);
            setIsLoading(false);
        } catch (error) {
            Logger.error('Failed to load chats', { error: error });
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    // Initial Load
    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    // Visibility-based polling fallback for when socket may have missed events
    // Refreshes conversation list when tab regains focus (every 30s while visible)
    useVisibilityPolling(fetchConversations, 30000, [fetchConversations], 'inbox-conversations');

    // Socket Listeners
    useEffect(() => {
        if (!socket || !currentAccount || !token) return;

        // Listen for list updates
        socket.on('conversation:updated', async (data: any) => {
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
                    isRead: selectedId === data.id // Mark as unread unless currently viewing
                };
                // Sort newest first (descending by updatedAt)
                return updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
            });

            if (selectedId === data.id && data.lastMessage) {
                setMessages(prev => {
                    if (prev.find(m => m.id === data.lastMessage.id)) return prev;
                    return [...prev, data.lastMessage];
                });
            }
        });

        // Listen for read status updates from other clients
        socket.on('conversation:read', (data: { id: string }) => {
            setConversations(prev => prev.map(c =>
                c.id === data.id ? { ...c, isRead: true } : c
            ));
        });

        socket.on('message:new', (msg: any) => {
            if (selectedId === msg.conversationId) {
                setMessages(prev => {
                    const updated = [...prev, msg];
                    // Also update cache
                    messagesCache.current.set(msg.conversationId, updated);
                    return updated;
                });
            } else {
                // Update cache even if not currently viewing this conversation
                const cached = messagesCache.current.get(msg.conversationId);
                if (cached) {
                    messagesCache.current.set(msg.conversationId, [...cached, msg]);
                }
            }
        });

        const fetchNewConversation = async (id: string) => {
            if (!currentAccount) return;
            try {
                const res = await fetch(`/api/chat/${id}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const newConv = await res.json();
                    setConversations(prev => {
                        if (prev.find(c => c.id === id)) return prev;
                        return [newConv, ...prev];
                    });
                }
            } catch (error) {
                Logger.error('Failed to fetch new conversation', { error: error });
            }
        };

        return () => {
            socket.off('conversation:updated');
            socket.off('conversation:read');
            socket.off('message:new');
        };
    }, [socket, selectedId, currentAccount, token]);

    // Fetch Messages when selected
    useEffect(() => {
        if (!selectedId || !token || !currentAccount) return;

        socket?.emit('join:conversation', selectedId);

        // Show cached messages immediately if available (instant switch)
        const cachedMessages = messagesCache.current.get(selectedId);
        if (cachedMessages) {
            setMessages(cachedMessages);
        }

        // Run all fetches in parallel for faster loading
        const fetchConversationData = async () => {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount.id
            };

            // Parallel fetch: messages, mark as read, and available channels
            const [messagesRes, , channelsRes] = await Promise.all([
                // Fetch messages
                fetch(`/api/chat/${selectedId}`, { headers }),
                // Mark as read (fire and forget, we don't need the result)
                fetch(`/api/chat/${selectedId}/read`, {
                    method: 'POST',
                    headers
                }).catch(err => Logger.error('Failed to mark as read', { error: err })),
                // Fetch available channels
                fetch(`/api/chat/${selectedId}/available-channels`, { headers })
                    .catch(() => null) // Gracefully handle errors
            ]);

            // Process messages response
            if (messagesRes.ok) {
                const data = await messagesRes.json();
                if (data.messages) {
                    setMessages(data.messages);
                    // Update cache with fresh data
                    messagesCache.current.set(selectedId, data.messages);
                    // Limit cache size to 20 conversations
                    if (messagesCache.current.size > 20) {
                        const firstKey = messagesCache.current.keys().next().value;
                        if (firstKey) messagesCache.current.delete(firstKey);
                    }
                }
            }

            // Update local read state optimistically
            setConversations(prev => prev.map(c =>
                c.id === selectedId ? { ...c, isRead: true } : c
            ));

            // Process channels response
            if (channelsRes?.ok) {
                const data = await channelsRes.json();
                setAvailableChannels(data.channels || []);
            } else {
                setAvailableChannels([]);
            }
        };

        fetchConversationData();

        return () => {
            socket?.emit('leave:conversation', selectedId);
        };
    }, [selectedId, token, socket, currentAccount]);

    const handleSendMessage = async (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean, channel?: ConversationChannel, emailAccountId?: string) => {
        if (!selectedId) return;

        try {
            const res = await fetch(`/api/chat/${selectedId}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ content, type, isInternal, channel, emailAccountId })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to send message');
            }
        } catch (error: any) {
            Logger.error('Failed to send message', { error: error?.message || error });
            alert(error?.message || 'Failed to send');
            throw error; // Re-throw to prevent clearing the input
        }
    };

    // Update conversation status (for keyboard shortcuts)
    const updateConversationStatus = useCallback(async (status: 'OPEN' | 'CLOSED') => {
        if (!selectedId || !token || !currentAccount) return;
        try {
            await fetch(`/api/chat/${selectedId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ status })
            });
            // Update local state
            setConversations(prev => prev.map(c =>
                c.id === selectedId ? { ...c, status } : c
            ));
        } catch (e) {
            Logger.error('Failed to update status', { error: e });
        }
    }, [selectedId, token, currentAccount]);

    // Keyboard shortcuts
    useKeyboardShortcuts({
        conversations,
        selectedId,
        onSelect: setSelectedId,
        onClose: () => updateConversationStatus('CLOSED'),
        onReopen: () => updateConversationStatus('OPEN'),
        onShowHelp: () => setIsShortcutsHelpOpen(true),
        enabled: !isComposeOpen && !isShortcutsHelpOpen
    });

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-gray-400">Loading inbox...</div>
            </div>
        );
    }

    return (
        <div className="-m-4 md:-m-6 lg:-m-8 h-[calc(100vh-64px)] flex bg-gray-100 overflow-hidden">
            {/* Conversations List */}
            <ConversationList
                conversations={conversations}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPreload={handlePreloadConversation}
                currentUserId={user?.id}
                onCompose={() => setIsComposeOpen(true)}
            />

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-white">
                {selectedId ? (
                    <ChatWindow
                        conversationId={selectedId}
                        messages={messages}
                        onSendMessage={handleSendMessage}
                        recipientEmail={recipientEmail}
                        recipientName={recipientName}
                        status={activeConversation?.status}
                        assigneeId={activeConversation?.assignedTo}
                        availableChannels={availableChannels}
                        currentChannel={activeConversation?.channel || 'CHAT'}
                        mergedRecipients={activeConversation?.mergedFrom || []}
                        customerData={activeConversation?.wooCustomer ? {
                            firstName: activeConversation.wooCustomer.firstName,
                            lastName: activeConversation.wooCustomer.lastName,
                            email: activeConversation.wooCustomer.email,
                            ordersCount: activeConversation.wooCustomer.ordersCount,
                            totalSpent: activeConversation.wooCustomer.totalSpent,
                            wooId: activeConversation.wooCustomer.wooId
                        } : {
                            // Fallback for guest conversations
                            firstName: activeConversation?.guestName?.split(' ')[0],
                            lastName: activeConversation?.guestName?.split(' ').slice(1).join(' '),
                            email: activeConversation?.guestEmail
                        }}
                        onStatusChange={async (newStatus, snoozeUntil) => {
                            const res = await fetch(`/api/chat/${selectedId}`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`,
                                    'x-account-id': currentAccount?.id || ''
                                },
                                body: JSON.stringify({
                                    status: newStatus,
                                    snoozeUntil: snoozeUntil?.toISOString()
                                })
                            });
                            if (res.ok) {
                                setConversations(prev => prev.map(c =>
                                    c.id === selectedId ? { ...c, status: newStatus } : c
                                ));
                            }
                        }}
                        onAssign={async (userId) => {
                            const res = await fetch(`/api/chat/${selectedId}`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`,
                                    'x-account-id': currentAccount?.id || ''
                                },
                                body: JSON.stringify({ assignedTo: userId || null })
                            });
                            if (res.ok) {
                                setConversations(prev => prev.map(c =>
                                    c.id === selectedId ? { ...c, assignedTo: userId || null } : c
                                ));
                            }
                        }}
                        onMerge={async (targetConversationId) => {
                            const res = await fetch(`/api/chat/${selectedId}/merge`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`,
                                    'x-account-id': currentAccount?.id || ''
                                },
                                body: JSON.stringify({ sourceId: targetConversationId })
                            });
                            if (res.ok) {
                                // Refresh conversations list
                                const convRes = await fetch('/api/chat/conversations', {
                                    headers: {
                                        'Authorization': `Bearer ${token}`,
                                        'x-account-id': currentAccount?.id || ''
                                    }
                                });
                                if (convRes.ok) {
                                    const data = await convRes.json();
                                    setConversations(data);
                                }
                            }
                        }}
                        onBlock={recipientEmail ? async () => {
                            const res = await fetch('/api/chat/block', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`,
                                    'x-account-id': currentAccount?.id || ''
                                },
                                body: JSON.stringify({ email: recipientEmail })
                            });
                            if (res.ok) {
                                // Update conversation to CLOSED
                                await fetch(`/api/chat/${selectedId}`, {
                                    method: 'PUT',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${token}`,
                                        'x-account-id': currentAccount?.id || ''
                                    },
                                    body: JSON.stringify({ status: 'CLOSED' })
                                });
                                setConversations(prev => prev.map(c =>
                                    c.id === selectedId ? { ...c, status: 'CLOSED' } : c
                                ));
                                alert('Contact blocked. Their future messages will be auto-resolved.');
                            } else {
                                alert('Failed to block contact');
                            }
                        } : undefined}
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                        <MessageSquare size={48} strokeWidth={1} className="mb-4" />
                        <p className="text-lg font-medium">Select a conversation</p>
                        <p className="text-sm">Choose from the list on the left</p>
                    </div>
                )}
            </div>

            {/* Contact Panel - Right Sidebar */}
            {selectedId && (
                <ContactPanel
                    conversation={activeConversation}
                    onSelectConversation={(id) => setSelectedId(id)}
                />
            )}

            {/* Compose New Email Modal */}
            {isComposeOpen && (
                <NewEmailModal
                    onClose={() => setIsComposeOpen(false)}
                    onSent={async (conversationId) => {
                        setIsComposeOpen(false);
                        setSelectedId(conversationId);
                        // Refresh conversations list
                        const res = await fetch('/api/chat/conversations', {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'x-account-id': currentAccount?.id || ''
                            }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            setConversations(data);
                        }
                    }}
                />
            )}

            {/* Keyboard Shortcuts Help Modal */}
            <KeyboardShortcutsHelp
                isOpen={isShortcutsHelpOpen}
                onClose={() => setIsShortcutsHelpOpen(false)}
            />
        </div>
    );
}
