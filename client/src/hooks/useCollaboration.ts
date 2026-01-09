import { useEffect, useState, useRef } from 'react';
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

export const useCollaboration = (documentId: string) => {
    const { socket, isConnected } = useSocket();
    const { user } = useAuth();
    const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);

    // Use a ref to track if we've joined to prevent double joins on strict mode/renders
    const joinedRef = useRef(false);

    useEffect(() => {
        if (!socket || !isConnected || !documentId || !user) return;

        Logger.debug('Joining document', { documentId });

        // Generate a random color for this session if not present
        const sessionColor = '#' + Math.floor(Math.random() * 16777215).toString(16);

        const presenceUser = {
            id: user.id || 'unknown',
            name: user.fullName || user.email || 'Unknown User',
            avatarUrl: user.avatarUrl || undefined, // Type safety
            color: sessionColor
        };

        socket.emit('join:document', { docId: documentId, user: presenceUser });
        joinedRef.current = true;

        const handlePresenceSync = (users: PresenceUser[]) => {
            // Filter out self? Usually nice to see self, or maybe not. 
            // Let's keep self for now to verify connection, but UI might hide it.
            setActiveUsers(users);
        };

        socket.on('presence:sync', handlePresenceSync);

        return () => {
            Logger.debug('Leaving document', { documentId });
            socket.emit('leave:document', { docId: documentId });
            socket.off('presence:sync', handlePresenceSync);
            joinedRef.current = false;
        };
    }, [socket, isConnected, documentId, user]); // User should technically be stable

    return {
        activeUsers,
        isConnected
    };
};
