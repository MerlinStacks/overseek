/**
 * Hook for tracking conversation presence/viewers.
 * Reuses the shared socket from SocketContext instead of creating new connections.
 */
import { useState, useEffect, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { isRecord } from '../utils/responseValidation';

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
    const { socket, isConnected } = useSocket();
    const userId = user?.id; const name = user?.fullName || user?.email || 'Agent'; const avatarUrl = user?.avatarUrl;
    const scope = useMemo(() => ({ socket, conversationId, userId, isConnected }), [socket, conversationId, userId, isConnected]);
    const [snapshot, setSnapshot] = useState<{ scope: typeof scope; viewers: Viewer[] } | null>(null);

    useEffect(() => {
        if (!socket || !isConnected || !conversationId || !userId) {
            return;
        }

        let disposed = false;
        const handleViewersSync = (value: unknown) => {
            if (disposed || !isRecord(value) || value.conversationId !== conversationId || !Array.isArray(value.viewers) || !value.viewers.every(viewer => isRecord(viewer) && typeof viewer.userId === 'string' && typeof viewer.name === 'string' && typeof viewer.connectedAt === 'number' && Number.isFinite(viewer.connectedAt) && (viewer.avatarUrl == null || typeof viewer.avatarUrl === 'string'))) return;
            setSnapshot({ scope, viewers: value.viewers as Viewer[] });
        };
        // Subscribe before joining: a fast sync must not be missed.
        socket.on('conversation:viewers', handleViewersSync);
        socket.emit('join:conversation', {
            conversationId,
            user: {
                id: userId,
                name,
                avatarUrl
            }
        });
        const heartbeat = setInterval(() => socket.emit('presence:heartbeat', { docId: `conv:${conversationId}` }), 20000);

        return () => {
            disposed = true;
            clearInterval(heartbeat);
            if (socket.connected) socket.emit('leave:conversation', { conversationId });
            socket.off('conversation:viewers', handleViewersSync);
        };
    }, [socket, conversationId, userId, name, avatarUrl, isConnected, scope]);

    const viewers = useMemo(() => snapshot?.scope === scope && isConnected && userId && conversationId ? snapshot.viewers : [], [snapshot, scope, isConnected, userId, conversationId]);

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
