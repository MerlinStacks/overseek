import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useLocation } from 'react-router-dom';
import { useSettings } from './SettingsContext';

const PresenceContext = createContext();

export const usePresence = () => useContext(PresenceContext);

// Generate random color for this session
const getRandomColor = () => {
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#818cf8', '#e879f9'];
    return colors[Math.floor(Math.random() * colors.length)];
};

export const PresenceProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);
    const [activeUsers, setActiveUsers] = useState([]);
    const location = useLocation();
    const { settings } = useSettings(); // Use backend URL if available

    // Use backend URL or default localhost
    // Use relative path for production (relies on Nginx proxy)
    const backendUrl = '/';
    // Ideally this comes from ENV or Settings properly

    useEffect(() => {
        const newSocket = io(backendUrl);
        setSocket(newSocket);

        const myColor = getRandomColor();
        const myName = `User ${Math.floor(Math.random() * 1000)}`; // Replace with Auth user name later

        // Store identity
        newSocket.userData = { user: myName, color: myColor };

        newSocket.on('user_joined', (user) => {
            setActiveUsers(prev => {
                if (prev.find(u => u.socketId === user.socketId)) return prev;
                return [...prev, user];
            });
        });

        newSocket.on('user_left', (socketId) => {
            setActiveUsers(prev => prev.filter(u => u.socketId !== socketId));
        });

        newSocket.on('request_announce', (requesterId) => {
            newSocket.emit('announce_presence', { targetSocketId: requesterId });
        });

        return () => newSocket.close();
    }, []);

    // Handle Page Changes
    useEffect(() => {
        if (!socket) return;

        // Clear previous users when changing page
        setActiveUsers([]);

        socket.emit('join_page', {
            page: location.pathname,
            user: socket.userData?.user || 'Guest',
            color: socket.userData?.color || '#ccc'
        });

    }, [location.pathname, socket]);

    return (
        <PresenceContext.Provider value={{ activeUsers }}>
            {children}
        </PresenceContext.Provider>
    );
};
