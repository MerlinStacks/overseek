/**
 * Hook for tracking conversation presence/viewers.
 * Reuses the shared socket from SocketContext instead of creating new connections.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';

interface Viewer {
    userId: string;
    name: string;
    avatarUrl?: string;
    connectedAt: number;
}

interface UseConversationPresenceReturn {
    viewers: Viewer[];
    otherViewers: Viewer[];
    hasOtherViewers: boolean;
}

/**
 * Tracks who is viewing a conversation for collision detection.
 * Uses the shared socket — no new connections per switch.
 */
export function useConversationPresence(conversationId: string | null): UseConversationPresenceReturn {
    const { user } = useAuth();
    const { socket } = useSocket();
    const [viewers, setViewers] = useState<Viewer[]>([]);
    const prevConversationId = useRef<string | null>(null);

    useEffect(() => {
        if (!socket || !conversationId || !user) {
            setViewers([]);
            return;
        }

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

        const handleViewersSync = (viewerList: Viewer[]) => {
            setViewers(viewerList);
        };

        socket.on('viewers:sync', handleViewersSync);

        return () => {
            socket.emit('leave:conversation', { conversationId });
            socket.off('viewers:sync', handleViewersSync);
        };
    }, [socket, conversationId, user]);

    // Memoize filtered list to avoid recalc on every render
    const otherViewers = useMemo(
        () => viewers.filter(v => v.userId !== user?.id),
        [viewers, user?.id]
    );

    return {
        viewers,
        otherViewers,
        hasOtherViewers: otherViewers.length > 0
    };
}
