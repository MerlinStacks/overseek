import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInbox } from './useInbox';

let currentAccount = { id: 'account-1' };
let navigate: ReturnType<typeof useNavigate>;
let locationSearch = '';

vi.mock('../context/SocketContext', () => ({
    useSocket: () => ({ socket: null, isConnected: false }),
}));

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({ token: 'token', user: { id: 'user-1' } }),
}));

vi.mock('../context/AccountContext', () => ({
    useAccount: () => ({ currentAccount }),
}));

vi.mock('../hooks/useCannedResponses', () => ({ useCannedResponses: () => ({}) }));
vi.mock('../hooks/useEmailAccounts', () => ({ useEmailAccounts: () => ({}) }));
vi.mock('../hooks/useVisibilityPolling', () => ({ useVisibilityPolling: () => undefined }));
vi.mock('../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => undefined }));
vi.mock('../hooks/useInboxSocket', () => ({ useInboxSocket: () => undefined }));
vi.mock('../utils/logger', () => ({
    Logger: { error: vi.fn(), warn: vi.fn() },
}));

function RouterState({ children }: { children: ReactNode }) {
    const routerNavigate = useNavigate();
    const search = useLocation().search;
    useEffect(() => {
        navigate = routerNavigate;
        locationSearch = search;
    }, [routerNavigate, search]);
    return children;
}

function wrapper(initialEntry: string) {
    return function TestWrapper({ children }: { children: ReactNode }) {
        return (
            <MemoryRouter initialEntries={[initialEntry]}>
                <RouterState>{children}</RouterState>
            </MemoryRouter>
        );
    };
}

function response(status: number, body: unknown = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn().mockResolvedValue(body),
    } as Response;
}

function mockInboxFetch(detailStatus: (accountId: string) => number = () => 200) {
    return vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url.startsWith('/api/chat/conversations?')) {
            return response(200, { conversations: [], hasMore: false });
        }
        if (url === '/api/chat/closed-1?limit=100') {
            const headers = init?.headers as Record<string, string>;
            const status = detailStatus(headers['x-account-id']);
            return response(status, status === 200 ? {
                id: 'closed-1',
                status: 'CLOSED',
                isRead: false,
                messages: [{ id: 'message-1', content: 'Archived message', createdAt: '2026-08-07T00:00:00Z' }],
            } : {});
        }
        if (url === '/api/chat/closed-1/read') return response(204);
        if (url === '/api/chat/closed-1/available-channels') return response(200, { channels: [] });
        throw new Error(`Unexpected request: ${url}`);
    });
}

function detailRequests(fetchMock: ReturnType<typeof mockInboxFetch>) {
    return fetchMock.mock.calls.filter(([input, init]) =>
        String(input) === '/api/chat/closed-1?limit=100' && (!init?.method || init.method === 'GET'));
}

const openConversation = {
    id: 'open-1',
    status: 'OPEN',
    isRead: false,
    guestEmail: 'customer@example.com',
    messages: [{ id: 'message-1', content: 'Help', createdAt: '2026-08-07T00:00:00Z' }],
    updatedAt: '2026-08-07T00:00:00Z',
};

function mockOpenConversationFetch(action: 'resolve' | 'block', actionStatus = 200) {
    let removed = false;
    return vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url.startsWith('/api/chat/conversations?')) {
            return response(200, { conversations: removed ? [] : [openConversation], hasMore: false });
        }
        if (url === '/api/chat/open-1?limit=100' && (!init?.method || init.method === 'GET')) {
            return response(200, openConversation);
        }
        if (url === '/api/chat/open-1/read') return response(204);
        if (url === '/api/chat/open-1/available-channels') return response(200, { channels: [] });
        if (action === 'resolve' && url === '/api/chat/open-1' && init?.method === 'PUT') {
            if (actionStatus < 300) removed = true;
            return response(actionStatus);
        }
        if (action === 'block' && url === '/api/chat/open-1/block' && init?.method === 'POST') {
            if (actionStatus < 300) removed = true;
            return response(actionStatus);
        }
        throw new Error(`Unexpected request: ${url}`);
    });
}

describe('useInbox deep links', () => {
    beforeEach(() => {
        currentAccount = { id: 'account-1' };
        locationSearch = '';
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('selects and hydrates a closed conversation with one detail request', async () => {
        const fetchMock = mockInboxFetch();
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useInbox(), {
            wrapper: wrapper('/inbox?conversationId=closed-1'),
        });

        await waitFor(() => {
            expect(result.current.activeConversation?.status).toBe('CLOSED');
            expect(result.current.messages).toHaveLength(1);
        });
        expect(result.current.selectedId).toBe('closed-1');
        expect(detailRequests(fetchMock)).toHaveLength(1);
    });

    it('clears selection when the conversationId query parameter is removed', async () => {
        vi.stubGlobal('fetch', mockInboxFetch());
        const { result } = renderHook(() => useInbox(), {
            wrapper: wrapper('/inbox?conversationId=closed-1'),
        });
        await waitFor(() => expect(result.current.activeConversation?.id).toBe('closed-1'));

        act(() => navigate('/inbox'));

        await waitFor(() => expect(result.current.selectedId).toBeNull());
        expect(locationSearch).toBe('');
    });

    it.each([404, 403])('clears selection and the query parameter after a %s response', async status => {
        vi.stubGlobal('fetch', mockInboxFetch(() => status));

        const { result } = renderHook(() => useInbox(), {
            wrapper: wrapper('/inbox?conversationId=closed-1'),
        });

        await waitFor(() => {
            expect(result.current.selectedId).toBeNull();
            expect(locationSearch).toBe('');
        });
    });

    it('does not retain a selection that is inaccessible after an account switch', async () => {
        const fetchMock = mockInboxFetch(accountId => accountId === 'account-1' ? 200 : 403);
        vi.stubGlobal('fetch', fetchMock);
        const { result, rerender } = renderHook(() => useInbox(), {
            wrapper: wrapper('/inbox?conversationId=closed-1'),
        });
        await waitFor(() => expect(result.current.activeConversation?.id).toBe('closed-1'));

        currentAccount = { id: 'account-2' };
        rerender();

        await waitFor(() => {
            expect(result.current.selectedId).toBeNull();
            expect(result.current.activeConversation).toBeUndefined();
            expect(locationSearch).toBe('');
        });
        expect(detailRequests(fetchMock)).toHaveLength(2);
    });
});

describe('useInbox conversation actions', () => {
    beforeEach(() => {
        currentAccount = { id: 'account-1' };
        locationSearch = '';
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('immediately removes and deselects a resolved conversation', async () => {
        vi.stubGlobal('fetch', mockOpenConversationFetch('resolve'));
        const { result } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });

        await waitFor(() => expect(result.current.conversations).toHaveLength(1));
        act(() => result.current.setSelectedId('open-1'));
        await waitFor(() => expect(result.current.messages).toHaveLength(1));

        await act(async () => result.current.handleStatusChange('CLOSED'));

        expect(result.current.conversations).toHaveLength(0);
        expect(result.current.selectedId).toBeNull();
        expect(result.current.messages).toHaveLength(0);
        expect(locationSearch).toBe('');
    });

    it('immediately removes and deselects a blocked conversation', async () => {
        const fetchMock = mockOpenConversationFetch('block');
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });

        await waitFor(() => expect(result.current.conversations).toHaveLength(1));
        act(() => result.current.setSelectedId('open-1'));
        await waitFor(() => expect(result.current.handleBlock).toBeTypeOf('function'));

        await act(async () => result.current.handleBlock?.());

        expect(result.current.conversations).toHaveLength(0);
        expect(result.current.selectedId).toBeNull();
        expect(result.current.messages).toHaveLength(0);
        expect(locationSearch).toBe('');
        expect(fetchMock).toHaveBeenCalledWith('/api/chat/open-1/block', expect.objectContaining({ method: 'POST' }));
    });

    it('keeps the conversation selected when resolving fails', async () => {
        vi.stubGlobal('fetch', mockOpenConversationFetch('resolve', 500));
        const { result } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });

        await waitFor(() => expect(result.current.conversations).toHaveLength(1));
        act(() => result.current.setSelectedId('open-1'));
        await waitFor(() => expect(result.current.selectedId).toBe('open-1'));

        await act(async () => result.current.handleStatusChange('CLOSED'));

        expect(result.current.conversations).toHaveLength(1);
        expect(result.current.selectedId).toBe('open-1');
    });
});

describe('useInbox stale request protection', () => {
    beforeEach(() => {
        currentAccount = { id: 'account-1' };
        locationSearch = '';
        vi.restoreAllMocks();
    });

    afterEach(() => vi.unstubAllGlobals());

    it('does not append a completed send to a newly selected conversation', async () => {
        let completeSend!: (response: Response) => void;
        const sendResponse = new Promise<Response>(resolve => { completeSend = resolve; });
        const conversations = ['open-1', 'open-2'].map((id, index) => ({
            ...openConversation,
            id,
            messages: [{ id: `message-${index + 1}`, content: id, createdAt: '2026-08-07T00:00:00Z' }],
        }));
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (url.startsWith('/api/chat/conversations?')) return response(200, { conversations, hasMore: false });
            if (url.endsWith('/read')) return response(204);
            if (url.endsWith('/available-channels')) return response(200, { channels: [] });
            if (url === '/api/chat/open-1/messages' && init?.method === 'POST') return sendResponse;
            const detail = conversations.find(conversation => url === `/api/chat/${conversation.id}?limit=100`);
            if (detail) return response(200, detail);
            throw new Error(`Unexpected request: ${url}`);
        }));

        const { result } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });
        await waitFor(() => expect(result.current.conversations).toHaveLength(2));
        act(() => result.current.setSelectedId('open-1'));
        await waitFor(() => expect(result.current.messages[0]?.content).toBe('open-1'));

        let sending!: Promise<void>;
        act(() => { sending = result.current.handleSendMessage('reply', 'AGENT', false); });
        act(() => result.current.setSelectedId('open-2'));
        await waitFor(() => expect(result.current.messages[0]?.content).toBe('open-2'));
        completeSend(response(200, { id: 'sent-1', content: 'reply', createdAt: '2026-08-07T00:01:00Z' }));
        await act(async () => sending);

        expect(result.current.messages.map(message => message.id)).toEqual(['message-2']);
    });

    it('ignores a conversation list response from the previous account', async () => {
        let completeFirstList!: (response: Response) => void;
        const firstList = new Promise<Response>(resolve => { completeFirstList = resolve; });
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (!url.startsWith('/api/chat/conversations?')) throw new Error(`Unexpected request: ${url}`);
            const accountId = (init?.headers as Record<string, string>)['x-account-id'];
            return accountId === 'account-1' ? firstList : response(200, { conversations: [], hasMore: false });
        }));

        const { result, rerender } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });
        currentAccount = { id: 'account-2' };
        rerender();
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        completeFirstList(response(200, { conversations: [openConversation], hasMore: false }));
        await act(async () => { await Promise.resolve(); });

        expect(result.current.conversations).toEqual([]);
        expect(result.current.selectedId).toBeNull();
    });

    it('uses the server nextCursor and deduplicates loaded conversations', async () => {
        const secondConversation = { ...openConversation, id: 'open-2' };
        const fetchMock = vi.fn<typeof fetch>(async input => {
            const url = String(input);
            if (url.includes('cursor=opaque%2B%2F%3D')) {
                return response(200, {
                    conversations: [openConversation, secondConversation],
                    hasMore: false,
                    nextCursor: null,
                });
            }
            if (url.startsWith('/api/chat/conversations?')) {
                return response(200, {
                    conversations: [openConversation],
                    hasMore: true,
                    nextCursor: 'opaque+/=',
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });
        await waitFor(() => expect(result.current.hasMore).toBe(true));

        await act(async () => result.current.loadMoreConversations());

        expect(result.current.conversations.map(conversation => conversation.id)).toEqual(['open-1', 'open-2']);
        expect(fetchMock.mock.calls.some(([input]) => String(input).includes('cursor=opaque%2B%2F%3D'))).toBe(true);
    });

    it('keeps a persisted failed delivery visible while rejecting the send', async () => {
        const failedMessage = {
            id: 'failed-1',
            content: 'reply',
            senderType: 'AGENT',
            isInternal: false,
            createdAt: '2026-08-07T00:01:00Z',
            deliveryStatus: 'FAILED',
            deliveryError: 'Message delivery failed. Please try again.',
        };
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (url.startsWith('/api/chat/conversations?')) return response(200, { conversations: [openConversation], hasMore: false });
            if (url === '/api/chat/open-1?limit=100') return response(200, openConversation);
            if (url === '/api/chat/open-1/read') return response(204);
            if (url === '/api/chat/open-1/available-channels') return response(200, { channels: [] });
            if (url === '/api/chat/open-1/messages' && init?.method === 'POST') {
                return response(502, { error: failedMessage.deliveryError, message: failedMessage });
            }
            throw new Error(`Unexpected request: ${url}`);
        }));

        const { result } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });
        await waitFor(() => expect(result.current.conversations).toHaveLength(1));
        act(() => result.current.setSelectedId('open-1'));
        await waitFor(() => expect(result.current.messages).toHaveLength(1));

        let sendError: unknown;
        await act(async () => {
            try {
                await result.current.handleSendMessage('reply', 'AGENT', false);
            } catch (error) {
                sendError = error;
            }
        });
        expect(sendError).toBeInstanceOf(Error);
        expect((sendError as Error).message).toContain('Message delivery failed');
        await waitFor(() => expect(result.current.messages.at(-1)).toMatchObject({ id: 'failed-1', deliveryStatus: 'FAILED' }));
    });
});

describe('useInbox message pagination', () => {
    beforeEach(() => {
        currentAccount = { id: 'account-1' };
        locationSearch = '';
        vi.restoreAllMocks();
    });

    afterEach(() => vi.unstubAllGlobals());

    it('loads, deduplicates, and chronologically merges an older page using the opaque cursor', async () => {
        const initialMessages = [
            { id: 'message-2', content: 'Second', createdAt: '2026-08-07T00:02:00Z' },
            { id: 'message-3', content: 'Third', createdAt: '2026-08-07T00:03:00Z' },
        ];
        const fetchMock = vi.fn<typeof fetch>(async input => {
            const url = String(input);
            if (url.startsWith('/api/chat/conversations?')) return response(200, { conversations: [openConversation], hasMore: false });
            if (url === '/api/chat/open-1?limit=100') return response(200, {
                ...openConversation,
                messages: initialMessages,
                hasMoreMessages: true,
                nextMessageCursor: 'opaque+/=',
            });
            if (url === '/api/chat/open-1?limit=100&before=opaque%2B%2F%3D') return response(200, {
                messages: [
                    { id: 'message-1', content: 'First', createdAt: '2026-08-07T00:01:00Z' },
                    initialMessages[0],
                ],
                hasMoreMessages: false,
                nextMessageCursor: null,
            });
            if (url === '/api/chat/open-1/read') return response(204);
            if (url === '/api/chat/open-1/available-channels') return response(200, { channels: [] });
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });
        await waitFor(() => expect(result.current.conversations).toHaveLength(1));
        act(() => result.current.setSelectedId('open-1'));
        await waitFor(() => expect(result.current.hasMoreMessages).toBe(true));

        await act(async () => result.current.loadOlderMessages());

        expect(result.current.messages.map(message => message.id)).toEqual(['message-1', 'message-2', 'message-3']);
        expect(result.current.hasMoreMessages).toBe(false);
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/chat/open-1?limit=100&before=opaque%2B%2F%3D',
            expect.objectContaining({ headers: expect.any(Object), signal: expect.any(AbortSignal) }),
        );
    });

    it('does not commit an older page after the selected conversation changes', async () => {
        let completeOlder!: (value: Response) => void;
        const olderResponse = new Promise<Response>(resolve => { completeOlder = resolve; });
        const conversations = ['open-1', 'open-2'].map(id => ({ ...openConversation, id }));
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
            const url = String(input);
            if (url.startsWith('/api/chat/conversations?')) return response(200, { conversations, hasMore: false });
            if (url === '/api/chat/open-1?limit=100') return response(200, {
                ...conversations[0], messages: [{ id: 'new-1', content: 'New one', createdAt: '2026-08-07T00:02:00Z' }],
                hasMoreMessages: true, nextMessageCursor: 'cursor-1',
            });
            if (url === '/api/chat/open-1?limit=100&before=cursor-1') return olderResponse;
            if (url === '/api/chat/open-2?limit=100') return response(200, {
                ...conversations[1], messages: [{ id: 'new-2', content: 'New two', createdAt: '2026-08-07T00:02:00Z' }],
                hasMoreMessages: false, nextMessageCursor: null,
            });
            if (url.endsWith('/read')) return response(204);
            if (url.endsWith('/available-channels')) return response(200, { channels: [] });
            throw new Error(`Unexpected request: ${url}`);
        }));

        const { result } = renderHook(() => useInbox(), { wrapper: wrapper('/inbox') });
        await waitFor(() => expect(result.current.conversations).toHaveLength(2));
        act(() => result.current.setSelectedId('open-1'));
        await waitFor(() => expect(result.current.hasMoreMessages).toBe(true));
        let loadingOlder!: Promise<void>;
        act(() => { loadingOlder = result.current.loadOlderMessages(); });
        act(() => result.current.setSelectedId('open-2'));
        await waitFor(() => expect(result.current.messages[0]?.id).toBe('new-2'));

        completeOlder(response(200, {
            messages: [{ id: 'old-1', content: 'Old one', createdAt: '2026-08-07T00:01:00Z' }],
            hasMoreMessages: false,
            nextMessageCursor: null,
        }));
        await act(async () => loadingOlder);

        expect(result.current.selectedId).toBe('open-2');
        expect(result.current.messages.map(message => message.id)).toEqual(['new-2']);
    });
});
