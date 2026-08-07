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
        if (url === '/api/chat/closed-1') {
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
        String(input) === '/api/chat/closed-1' && (!init?.method || init.method === 'GET'));
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
