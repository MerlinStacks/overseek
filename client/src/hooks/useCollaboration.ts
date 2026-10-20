/** Tracks document presence, scoped to the current account, user and connection. */
import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

export interface PresenceUser {
    userId: string;
    name: string;
    avatarUrl?: string;
    color?: string;
    connectedAt: number;
}

const HEARTBEAT_INTERVAL_MS = 30000;

export const useCollaboration = (documentId: string) => {
    const { socket, isConnected } = useSocket();
    const { user } = useAuth();
    const { currentAccount } = useAccount();
    const userId = user?.id;
    const name = user?.fullName || user?.email || 'Unknown User';
    const avatarUrl = user?.avatarUrl || undefined;
    const accountId = currentAccount?.id;
    const scope = useMemo(() => ({ socket, isConnected, documentId, userId, name, avatarUrl, accountId }),
        [socket, isConnected, documentId, userId, name, avatarUrl, accountId]);
    const [presence, setPresence] = useState<{ scope: typeof scope; users: PresenceUser[] } | null>(null);

    useEffect(() => {
        const { socket, isConnected, documentId, userId, name, avatarUrl, accountId } = scope;
        if (!socket || !isConnected || !documentId || !userId || !accountId) return;
        let active = true;
        const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        const join = () => socket.emit('join:document', { docId: documentId, user: { id: userId, name, avatarUrl, color } });
        const sync = (users: PresenceUser[]) => {
            if (active && Array.isArray(users)) setPresence({ scope, users });
        };
        // Subscribe before joining: the server may broadcast the initial list immediately.
        socket.on('presence:sync', sync);
        join();
        let interval: ReturnType<typeof setInterval> | undefined;
        const heartbeat = () => socket.emit('presence:heartbeat', { docId: documentId });
        const start = () => { if (interval === undefined) interval = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS); };
        const stop = () => { clearInterval(interval); interval = undefined; };
        if (!document.hidden) start();
        const visibility = () => {
            if (document.hidden) stop();
            else {
                // A heartbeat cannot recreate an entry that expired while this tab was hidden.
                join();
                start();
            }
        };
        document.addEventListener('visibilitychange', visibility);
        return () => {
            active = false;
            stop();
            document.removeEventListener('visibilitychange', visibility);
            socket.off('presence:sync', sync);
            // Do not buffer a stale leave until a future reconnection.
            if (socket.connected) socket.emit('leave:document', { docId: documentId });
        };
    }, [scope]);

    return { activeUsers: presence?.scope === scope && isConnected ? presence.users : [], isConnected };
};
