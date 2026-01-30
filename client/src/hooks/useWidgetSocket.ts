import { useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';

/**
 * Hook for widgets to subscribe to real-time socket events.
 * Automatically handles cleanup on unmount.
 * 
 * @param eventName - The socket event to listen for (e.g., 'order:new')
 * @param onEvent - Callback when event is received
 * @param enabled - Optional flag to disable listening
 */
export function useWidgetSocket<T = any>(
    eventName: string,
    onEvent: (data: T) => void,
    enabled: boolean = true
) {
    const { socket, isConnected } = useSocket();
    const callbackRef = useRef(onEvent);

    // Keep callback reference up to date without re-subscribing
    useEffect(() => {
        callbackRef.current = onEvent;
    }, [onEvent]);

    useEffect(() => {
        if (!socket || !isConnected || !enabled) return;

        const handler = (data: T) => {
            callbackRef.current(data);
        };

        socket.on(eventName, handler);

        return () => {
            socket.off(eventName, handler);
        };
    }, [socket, isConnected, eventName, enabled]);

    return { isConnected };
}

/**
 * Hook for widgets to subscribe to multiple socket events.
 */
export function useWidgetSocketMulti(
    events: Array<{ event: string; handler: (data: any) => void }>,
    enabled: boolean = true
) {
    const { socket, isConnected } = useSocket();

    useEffect(() => {
        if (!socket || !isConnected || !enabled) return;

        for (const { event, handler } of events) {
            socket.on(event, handler);
        }

        return () => {
            for (const { event, handler } of events) {
                socket.off(event, handler);
            }
        };
    }, [socket, isConnected, events, enabled]);

    return { isConnected };
}
