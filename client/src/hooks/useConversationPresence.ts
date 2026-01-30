/**
 * Hook for tracking conversation presence/viewers.
 * Emits join/leave events and listens for viewers:sync updates.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

interface Viewer {
    userId: string;
    name: string;
    avatarUrl?: string;
    connectedAt: number;
}

interface UseConversationPresenceReturn {
    /** List of users currently viewing this conversation */
    viewers: Viewer[];
    /** Other viewers (excluding current user) */
    otherViewers: Viewer[];
    /** Whether there are other viewers */
    hasOtherViewers: boolean;
}

/**
 * Tracks who is viewing a conversation for collision detection.
 * Emits join/leave events and syncs viewer list via Socket.IO.
 */
export function useConversationPresence(conversationId: string | null): UseConversationPresenceReturn {
    const { user } = useAuth();
    const [viewers, setViewers] = useState<Viewer[]>([]);
    const socketRef = useRef<Socket | null>(null);
    const prevConversationId = useRef<string | null>(null);

    useEffect(() => {
        if (!conversationId || !user) {
            setViewers([]);
            return;
        }

        // Get or create socket connection
        const socketUrl = import.meta.env.VITE_API_URL || '';
        const socket = io(socketUrl, {
            transports: ['websocket'],
            autoConnect: true
        });
        socketRef.current = socket;

        // Leave previous conversation if switching
        if (prevConversationId.current && prevConversationId.current !== conversationId) {
            socket.emit('leave:conversation', { conversationId: prevConversationId.current });
        }

        // Join new conversation with user info
        socket.emit('join:conversation', {
            conversationId,
            user: {
                id: user.id,
                name: user.fullName || user.email || 'Agent',
                avatarUrl: user.avatarUrl
            }
        });
        prevConversationId.current = conversationId;

        // Listen for viewer updates
        const handleViewersSync = (viewerList: Viewer[]) => {
            setViewers(viewerList);
        };

        socket.on('viewers:sync', handleViewersSync);

        // Cleanup on unmount or when conversation changes
        return () => {
            socket.emit('leave:conversation', { conversationId });
            socket.off('viewers:sync', handleViewersSync);
            socket.disconnect();
        };
    }, [conversationId, user]);

    // Filter out current user from viewer list
    const otherViewers = viewers.filter(v => v.userId !== user?.id);

    return {
        viewers,
        otherViewers,
        hasOtherViewers: otherViewers.length > 0
    };
}
