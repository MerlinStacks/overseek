/**
 * useCollaboration - Client-side presence hook for collaborative editing.
 * 
 * Tracks active users viewing a document and sends heartbeats to keep presence alive.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Logger } from '../utils/logger';

export interface PresenceUser {
    userId: string;
    name: string;
    avatarUrl?: string;
    color?: string;
    connectedAt: number;
}

/** Heartbeat interval in ms - must be less than server TTL (120s) */
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

export const useCollaboration = (documentId: string) => {
    const { socket, isConnected } = useSocket();
    const { user } = useAuth();
    const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);

    // Track if we've joined to prevent double joins on strict mode/renders
    const joinedRef = useRef(false);
    const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Memoized heartbeat sender
    const sendHeartbeat = useCallback(() => {
        if (socket && joinedRef.current && documentId) {
            socket.emit('presence:heartbeat', { docId: documentId });
        }
    }, [socket, documentId]);

    useEffect(() => {
        if (!socket || !isConnected || !documentId || !user) return;

        Logger.debug('Joining document', { documentId });

        // Generate a random color for this session
        const sessionColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

        const presenceUser = {
            id: user.id || 'unknown',
            name: user.fullName || user.email || 'Unknown User',
            avatarUrl: user.avatarUrl || undefined,
            color: sessionColor
        };

        socket.emit('join:document', { docId: documentId, user: presenceUser });
        joinedRef.current = true;

        const handlePresenceSync = (users: PresenceUser[]) => {
            setActiveUsers(users);
        };

        socket.on('presence:sync', handlePresenceSync);

        // Start heartbeat interval to keep presence alive
        heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

        // Pause heartbeat when tab is hidden, resume when visible
        const handleVisibilityChange = () => {
            if (document.hidden) {
                // Tab hidden - stop heartbeats (will expire after TTL)
                if (heartbeatIntervalRef.current) {
                    clearInterval(heartbeatIntervalRef.current);
                    heartbeatIntervalRef.current = null;
                }
            } else {
                // Tab visible again - send immediate heartbeat and restart interval
                sendHeartbeat();
                if (!heartbeatIntervalRef.current) {
                    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            Logger.debug('Leaving document', { documentId });

            // Clear heartbeat interval
            if (heartbeatIntervalRef.current) {
                clearInterval(heartbeatIntervalRef.current);
                heartbeatIntervalRef.current = null;
            }

            // Remove visibility listener
            document.removeEventListener('visibilitychange', handleVisibilityChange);

            // Leave document
            socket.emit('leave:document', { docId: documentId });
            socket.off('presence:sync', handlePresenceSync);
            joinedRef.current = false;
        };
    }, [socket, isConnected, documentId, user, sendHeartbeat]);

    return {
        activeUsers,
        isConnected
    };
};
