import { act, renderHook } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { useInboxSocket } from './useInboxSocket';
import type { InboxConversation, InboxMessage } from '../types/inbox';

vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));

function createSocket() {
    const listeners = new Map<string, (payload: never) => void>();
    return {
        on: vi.fn((event: string, listener: (payload: never) => void) => listeners.set(event, listener)),
        off: vi.fn((event: string) => listeners.delete(event)),
        emitEvent: (event: string, payload: unknown) => listeners.get(event)?.(payload as never),
    };
}

describe('useInboxSocket', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('debounces and persists read state for customer messages in the selected conversation', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: true } as Response);
        vi.stubGlobal('fetch', fetchMock);
        const socket = createSocket();

        const { result } = renderHook(() => {
            const [conversations, setConversations] = useState<InboxConversation[]>([{
                id: 'conversation-1', status: 'OPEN', updatedAt: '', messages: [], isRead: false,
            }]);
            const [messages, setMessages] = useState<InboxMessage[]>([]);
            const messagesCache = useRef(new Map<string, InboxMessage[]>());
            const shouldIncludeConversation = useCallback(() => true, []);
            useInboxSocket({
                socket: socket as unknown as Socket,
                selectedId: 'conversation-1',
                token: 'token',
                accountId: 'account-1',
                messagesCache,
                shouldIncludeConversation,
                setConversations,
                setMessages,
            });
            return { conversations, messages };
        });

        act(() => {
            socket.emitEvent('message:new', {
                id: 'message-1', conversationId: 'conversation-1', senderType: 'CUSTOMER',
                content: 'Hello', createdAt: '2026-08-08T00:00:00Z', isInternal: false,
            });
            socket.emitEvent('message:new', {
                id: 'message-2', conversationId: 'conversation-1', senderType: 'CUSTOMER',
                content: 'Anyone there?', createdAt: '2026-08-08T00:00:01Z', isInternal: false,
            });
        });
        await act(async () => vi.advanceTimersByTimeAsync(250));

        expect(result.current.messages).toHaveLength(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/chat/conversation-1/read', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'x-account-id': 'account-1' }),
        }));
        expect(result.current.conversations[0].isRead).toBe(true);
    });
});
