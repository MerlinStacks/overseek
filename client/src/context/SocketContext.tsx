import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useAccount } from './AccountContext';
/* eslint-disable react-refresh/only-export-components */

interface SocketContextType { socket: Socket | null; isConnected: boolean }
const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false });
export const useSocket = () => useContext(SocketContext);

export function SocketProvider({ children }: { children: React.ReactNode }) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const scope = JSON.stringify([token, accountId]);
    const [state, setState] = useState<{ scope: string; socket: Socket; isConnected: boolean } | null>(null);
    useEffect(() => {
        if (!token || !accountId) return;
        let disposed = false;
        const socket = io('/', { path: '/socket.io', auth: { token }, query: { accountId } });
        const publish = (connected: boolean) => { if (!disposed) setState({ scope, socket, isConnected: connected }); };
        const connect = () => { if (disposed) return; socket.emit('join:account', accountId); publish(true); };
        const disconnect = () => publish(false);
        socket.on('connect', connect); socket.on('disconnect', disconnect); socket.on('connect_error', disconnect);
        queueMicrotask(() => publish(socket.connected));
        return () => {
            disposed = true;
            socket.off('connect', connect); socket.off('disconnect', disconnect); socket.off('connect_error', disconnect);
            socket.disconnect();
        };
    }, [token, accountId, scope]);
    const value = token && accountId && state?.scope === scope ? { socket: state.socket, isConnected: state.isConnected } : { socket: null, isConnected: false };
    return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
