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
 * Uses ref to prevent re-subscription on every render.
 */
export function useWidgetSocketMulti(
    events: Array<{ event: string; handler: (data: any) => void }>,
    enabled: boolean = true
) {
    const { socket, isConnected } = useSocket();
    const eventsRef = useRef(events);

    // Keep events ref up to date without re-subscribing
    useEffect(() => {
        eventsRef.current = events;
    }, [events]);

    useEffect(() => {
        if (!socket || !isConnected || !enabled) return;

        /** Stable wrappers that delegate to the latest handlers via ref */
        const wrappers = eventsRef.current.map(({ event }) => ({
            event,
            fn: (data: any) => {
                const current = eventsRef.current.find(e => e.event === event);
                current?.handler(data);
            }
        }));

        for (const { event, fn } of wrappers) {
            socket.on(event, fn);
        }

        return () => {
            for (const { event, fn } of wrappers) {
                socket.off(event, fn);
            }
        };
    // Only re-subscribe when socket connection state or enabled flag changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, isConnected, enabled]);

    return { isConnected };
}
