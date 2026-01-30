/**
 * Hook for managing typing indicator state in chat conversations.
 * Handles listening for customer typing events and emitting agent typing events.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';

interface UseTypingIndicatorOptions {
    /** Conversation ID to listen for typing events */
    conversationId: string;
    /** Current input value - used to emit typing events */
    input: string;
}

interface UseTypingIndicatorReturn {
    /** Whether the customer is currently typing */
    isCustomerTyping: boolean;
}

/**
 * Manages typing indicator state for a conversation.
 * Listens for customer typing events via socket and emits agent typing events.
 */
export function useTypingIndicator({ conversationId, input }: UseTypingIndicatorOptions): UseTypingIndicatorReturn {
    const { socket } = useSocket();
    const [isCustomerTyping, setIsCustomerTyping] = useState(false);

    // Refs for managing debounce and timeout
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastTypingEmitRef = useRef<number>(0);

    // Listen for customer typing events
    useEffect(() => {
        if (!socket || !conversationId) return;

        const handleTypingStart = (data: { conversationId: string }) => {
            if (data.conversationId === conversationId) {
                setIsCustomerTyping(true);
                // Auto-clear after 3 seconds if no stop event
                if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                }
                typingTimeoutRef.current = setTimeout(() => {
                    setIsCustomerTyping(false);
                }, 3000);
            }
        };

        const handleTypingStop = (data: { conversationId: string }) => {
            if (data.conversationId === conversationId) {
                setIsCustomerTyping(false);
                if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                }
            }
        };

        socket.on('typing:start', handleTypingStart);
        socket.on('typing:stop', handleTypingStop);

        return () => {
            socket.off('typing:start', handleTypingStart);
            socket.off('typing:stop', handleTypingStop);
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
        };
    }, [socket, conversationId]);

    /**
     * Emit typing events when composing (debounced to 500ms).
     * Only emits if 500ms have passed since last emit.
     */
    const emitTyping = useCallback(() => {
        if (!socket || !conversationId) return;

        const now = Date.now();
        // Only emit every 500ms to avoid flooding
        if (now - lastTypingEmitRef.current > 500) {
            socket.emit('typing:start', { conversationId });
            lastTypingEmitRef.current = now;
        }
    }, [socket, conversationId]);

    // Emit typing events when input changes
    useEffect(() => {
        if (input) {
            emitTyping();
        } else if (socket && conversationId) {
            socket.emit('typing:stop', { conversationId });
        }
    }, [input, emitTyping, socket, conversationId]);

    return { isCustomerTyping };
}
