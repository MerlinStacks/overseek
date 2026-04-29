
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useAccount } from './AccountContext';
import { Logger } from '../utils/logger';
/* eslint-disable react-refresh/only-export-components */

interface SocketContextType {
    socket: Socket | null;
    isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
    socket: null,
    isConnected: false
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        if (!token || !currentAccount) {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
                queueMicrotask(() => setSocket(null));
            }
            return;
        }

        // Initialize socket
        // Assume API is on same host/port in dev relative to proxy, 
        // OR define env. But setup usually proxies /api.
        // If create-react-app or vite sends /api -> localhost:3000, 
        // socket.io client usually needs full URL if not same origin serving.
        // Assuming Vite proxy setting handles /socket.io or we use hardcoded port for now.
        // Let's assume standard behavior:
        // Connect to relative path so Vite proxy handles it
        const newSocket = io('/', {
            path: '/socket.io',
            auth: { token },
            query: { accountId: currentAccount.id }
        });

        newSocket.on('connect', () => {
            Logger.debug('Socket connected', { accountId: currentAccount.id });
            setIsConnected(true);
            newSocket.emit('join:account', currentAccount.id);
        });

        newSocket.on('disconnect', () => {
            Logger.debug('Socket disconnected');
            setIsConnected(false);
        });

        socketRef.current = newSocket;
        queueMicrotask(() => setSocket(newSocket));

        return () => {
            newSocket.disconnect();
            if (socketRef.current === newSocket) {
                socketRef.current = null;
            }
        };
    }, [token, currentAccount]);

    return (
        <SocketContext.Provider value={{ socket, isConnected }}>
            {children}
        </SocketContext.Provider>
    );
};
