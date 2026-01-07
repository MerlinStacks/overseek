
import { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { ConversationList } from '../components/chat/ConversationList';
import { ChatWindow } from '../components/chat/ChatWindow';
import { ContactPanel } from '../components/chat/ContactPanel';
import { MessageSquare } from 'lucide-react';

export function InboxPage() {
    const { socket, isConnected } = useSocket();
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    const [conversations, setConversations] = useState<any[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const activeConversation = conversations.find(c => c.id === selectedId);

    // Get recipient info for ChatWindow
    const recipientEmail = activeConversation?.wooCustomer?.email || activeConversation?.guestEmail;
    const recipientName = activeConversation?.wooCustomer
        ? `${activeConversation.wooCustomer.firstName || ''} ${activeConversation.wooCustomer.lastName || ''}`.trim()
        : activeConversation?.guestName;

    // Initial Load
    useEffect(() => {
        if (!currentAccount || !token) return;

        const fetchConversations = async () => {
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
                console.error('Failed to load chats', error);
                setIsLoading(false);
            }
        };

        fetchConversations();
    }, [currentAccount, token]);

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
                    updatedAt: data.updatedAt
                };
                return updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
            });

            if (selectedId === data.id && data.lastMessage) {
                setMessages(prev => {
                    if (prev.find(m => m.id === data.lastMessage.id)) return prev;
                    return [...prev, data.lastMessage];
                });
            }
        });

        socket.on('message:new', (msg: any) => {
            if (selectedId === msg.conversationId) {
                setMessages(prev => [...prev, msg]);
            }
        });

        const fetchNewConversation = async (id: string) => {
            try {
                const res = await fetch(`/api/chat/${id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const newConv = await res.json();
                    setConversations(prev => {
                        if (prev.find(c => c.id === id)) return prev;
                        return [newConv, ...prev];
                    });
                }
            } catch (error) {
                console.error('Failed to fetch new conversation', error);
            }
        };

        return () => {
            socket.off('conversation:updated');
            socket.off('message:new');
        };
    }, [socket, selectedId, currentAccount, token]);

    // Fetch Messages when selected
    useEffect(() => {
        if (!selectedId || !token) return;

        socket?.emit('join:conversation', selectedId);

        const fetchMessages = async () => {
            const res = await fetch(`/api/chat/${selectedId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.messages) setMessages(data.messages);
        };
        fetchMessages();

        return () => {
            socket?.emit('leave:conversation', selectedId);
        };
    }, [selectedId, token, socket]);

    const handleSendMessage = async (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean) => {
        if (!selectedId) return;

        const res = await fetch(`/api/chat/${selectedId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content, type, isInternal })
        });

        if (!res.ok) {
            alert('Failed to send');
        }
    };

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
                currentUserId={user?.id}
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
                />
            )}
        </div>
    );
}
