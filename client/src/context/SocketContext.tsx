
import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useAccount } from './AccountContext';
import { Logger } from '../utils/logger';

interface SocketContextType {
    socket: Socket | null;
    firstName: string;
    isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
    socket: null,
    firstName: '',
    isConnected: false
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        if (!token || !currentAccount) {
            if (socket) {
                socket.disconnect();
                setSocket(null);
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

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, [token, currentAccount?.id]);

    return (
        <SocketContext.Provider value={{ socket, isConnected, firstName: 'Test' }}>
            {children}
        </SocketContext.Provider>
    );
};
