import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileChat } from './useMobileChat';

let account = { id: 'account-1' };

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'user-1' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: account }) }));
vi.mock('../../context/SocketContext', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('../../hooks/useCannedResponses', () => ({
    useCannedResponses: () => ({
        cannedResponses: [], filteredCanned: [], showCanned: false,
        handleInputForCanned: vi.fn(), selectCanned: vi.fn(), setShowCanned: vi.fn(),
    }),
}));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));

function response(status: number, body: unknown = {}) {
    return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

const conversation = {
    id: 'conversation-1',
    status: 'OPEN',
    channel: 'EMAIL',
    guestEmail: 'customer@example.com',
    messages: [],
};

describe('useMobileChat', () => {
    beforeEach(() => {
        account = { id: 'account-1' };
        vi.restoreAllMocks();
        vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('request-1').mockReturnValue('request-2') });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('shows a persisted failed send and reuses its client request ID on retry', async () => {
        const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (url === '/api/chat/conversation-1') return response(200, conversation);
            if (url.endsWith('/read')) return response(204);
            if (url.endsWith('/messages') && init?.method === 'POST') {
                const clientRequestId = JSON.parse(String(init.body)).clientRequestId;
                return response(502, {
                    error: 'Delivery to customer failed',
                    message: {
                        id: 'failed-message', content: 'Hello', senderType: 'AGENT', createdAt: '2026-08-08T00:00:00Z',
                        isInternal: false, clientRequestId, deliveryStatus: 'FAILED', deliveryError: 'Delivery to customer failed',
                    },
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation?.id).toBe('conversation-1'));

        act(() => result.current.handleInputChange('Hello'));
        await act(async () => result.current.handleSend());
        await act(async () => result.current.handleSend());

        const sendBodies = fetchMock.mock.calls
            .filter(([input, init]) => String(input).endsWith('/messages') && init?.method === 'POST')
            .map(([, init]) => JSON.parse(String(init?.body)));
        expect(sendBodies.map(body => body.clientRequestId)).toEqual([
            'mobile-conversation-1-request-1',
            'mobile-conversation-1-request-1',
        ]);
        expect(result.current.messages[0]).toMatchObject({ id: 'failed-message', deliveryStatus: 'FAILED' });
        expect(result.current.sendError).toBe('Delivery to customer failed');
        expect(result.current.newMessage).toBe('Hello');
    });

    it('reuses the client request ID when the same attachment is retried', async () => {
        const uploadIds: string[] = [];
        const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (url === '/api/chat/conversation-1') return response(200, conversation);
            if (url.endsWith('/read')) return response(204);
            if (url.endsWith('/message-with-attachments') && init?.method === 'POST') {
                const clientRequestId = String((init.body as FormData).get('clientRequestId'));
                uploadIds.push(clientRequestId);
                return response(502, {
                    error: 'Attachment delivery failed',
                    message: {
                        id: 'failed-attachment', content: 'Attachment', senderType: 'AGENT', createdAt: '2026-08-08T00:00:00Z',
                        isInternal: false, clientRequestId, deliveryStatus: 'FAILED', deliveryError: 'Attachment delivery failed',
                    },
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation?.id).toBe('conversation-1'));
        const file = new File(['file'], 'invoice.pdf', { type: 'application/pdf', lastModified: 100 });
        const event = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;

        await act(async () => result.current.handleFileUpload(event));
        await act(async () => result.current.handleFileUpload(event));

        expect(uploadIds).toEqual([
            'mobile-attachment-conversation-1-request-1',
            'mobile-attachment-conversation-1-request-1',
        ]);
        expect(result.current.messages[0]).toMatchObject({ id: 'failed-attachment', deliveryStatus: 'FAILED' });
        expect(result.current.sendError).toBe('Attachment delivery failed');
    });

    it('aborts resolve and ignores its result after the conversation changes', async () => {
        let finishResolve!: (response: Response) => void;
        const resolveResponse = new Promise<Response>(resolve => { finishResolve = resolve; });
        const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (url === '/api/chat/conversation-1' && init?.method === 'PUT') return resolveResponse;
            if (url === '/api/chat/conversation-1') return response(200, conversation);
            if (url === '/api/chat/conversation-2') return response(200, { ...conversation, id: 'conversation-2' });
            if (url.endsWith('/read')) return response(204);
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        const { result, rerender } = renderHook(({ id }) => useMobileChat(id), { initialProps: { id: 'conversation-1' } });
        await waitFor(() => expect(result.current.conversation?.id).toBe('conversation-1'));

        let resolving!: Promise<boolean | undefined>;
        act(() => { resolving = result.current.handleResolve(); });
        rerender({ id: 'conversation-2' });
        finishResolve(response(200));

        await expect(resolving).resolves.toBe(false);
        const resolveCall = fetchMock.mock.calls.find(([input, init]) => String(input) === '/api/chat/conversation-1' && init?.method === 'PUT');
        expect((resolveCall?.[1]?.signal as AbortSignal).aborted).toBe(true);
    });
});
