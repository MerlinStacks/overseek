import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileChat } from './useMobileChat';
import { mobileDraftKey, MOBILE_DRAFT_TTL } from './mobileChatDraft';

let account = { id: 'account-1' };
let user = { id: 'user-1' };

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: account }) }));
vi.mock('../../context/SocketContext', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('../../hooks/useCannedResponses', () => ({
    useCannedResponses: () => ({
        cannedResponses: [], filteredCanned: [], showCanned: false,
        handleInputForCanned: vi.fn(), selectCanned: (reply: { content: string }) => reply.content, setShowCanned: vi.fn(),
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
        user = { id: 'user-1' };
        vi.restoreAllMocks();
        localStorage.clear();
        vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('request-1').mockReturnValue('request-2') });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('inserts readable saved replies and preserves an existing draft', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response(200, conversation)));
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation?.id).toBe('conversation-1'));
        const reply = { id: 'reply-1', shortcut: 'thanks', content: '<p>Thanks <strong>Sam</strong>!</p><p>Support team</p>' };

        act(() => result.current.handleInputChange('My introduction'));
        act(() => result.current.handleToggleCanned());
        expect(result.current.newMessage).toBe('My introduction');
        act(() => result.current.handleSelectCanned(reply));
        expect(result.current.newMessage).toBe('<p>My introduction</p><p>Thanks <strong>Sam</strong>!</p><p>Support team</p>');

        act(() => result.current.handleInputChange('/thanks'));
        act(() => result.current.handleSelectCanned(reply));
        expect(result.current.newMessage).toBe('<p>Thanks <strong>Sam</strong>!</p><p>Support team</p>');
    });

    it('allows Return to insert a newline without sending', async () => {
        const fetchMock = vi.fn(async () => response(200, conversation));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation?.id).toBe('conversation-1'));
        act(() => result.current.handleInputChange('First line'));
        const preventDefault = vi.fn();
        const callsBefore = fetchMock.mock.calls.length;
        act(() => result.current.handleKeyPress({ key: 'Enter', preventDefault } as unknown as React.KeyboardEvent));
        expect(preventDefault).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls).toHaveLength(callsBefore);
    });

    it('preserves sanitized HTML email AI drafts', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input) => String(input).endsWith('/ai-draft')
            ? response(200, { draft: '<p>Hello!</p><p onclick="evil()">How can we help?</p><script>evil()</script>' })
            : response(200, conversation)));
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation?.id).toBe('conversation-1'));
        await act(async () => result.current.handleGenerateAIDraft());
        expect(result.current.newMessage).toBe('<p>Hello!</p><p>How can we help?</p>');
    });

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
        expect(uploadIds).toEqual([]);
        expect(result.current.pendingAttachment).toBe(file);
        await act(async () => result.current.handleSendAttachment());
        expect(result.current.pendingAttachment).toBe(file);
        await act(async () => result.current.handleSendAttachment());

        expect(uploadIds).toEqual([
            'mobile-attachment-conversation-1-request-1',
            'mobile-attachment-conversation-1-request-1',
        ]);
        expect(result.current.messages[0]).toMatchObject({ id: 'failed-attachment', deliveryStatus: 'FAILED' });
        expect(result.current.sendError).toBe('Attachment delivery failed');
    });

    it('recovers drafts across unmount and isolates user, account and conversation switches', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response(200, conversation)));
        const first = renderHook(() => useMobileChat('conversation-1'));
        act(() => first.result.current.handleInputChange('Recovered'));
        first.unmount();
        const { result, rerender } = renderHook(({ id }) => useMobileChat(id), { initialProps: { id: 'conversation-1' } });
        expect(result.current.newMessage).toBe('Recovered');
        rerender({ id: 'conversation-2' });
        expect(result.current.newMessage).toBe('');
        act(() => result.current.handleInputChange('Second'));
        account = { id: 'account-2' };
        rerender({ id: 'conversation-2' });
        expect(result.current.newMessage).toBe('');
        act(() => result.current.handleInputChange('Other account'));
        user = { id: 'user-2' };
        rerender({ id: 'conversation-2' });
        expect(result.current.newMessage).toBe('');
        user = { id: 'user-1' };
        account = { id: 'account-1' };
        rerender({ id: 'conversation-2' });
        expect(result.current.newMessage).toBe('Second');
        rerender({ id: 'conversation-1' });
        expect(result.current.newMessage).toBe('Recovered');
        await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('ignores expired/corrupt drafts and tolerates unavailable storage', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response(200, conversation)));
        const key = mobileDraftKey(user.id, account.id, 'conversation-1')!;
        localStorage.setItem(key, JSON.stringify({ content: 'Expired', updatedAt: Date.now() - MOBILE_DRAFT_TTL }));
        const first = renderHook(() => useMobileChat('conversation-1'));
        expect(first.result.current.newMessage).toBe('');
        expect(localStorage.getItem(key)).toBeNull();
        first.unmount();
        localStorage.setItem(key, '{broken');
        const second = renderHook(() => useMobileChat('conversation-1'));
        expect(second.result.current.newMessage).toBe('');
        second.unmount();
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Disabled'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
        const third = renderHook(() => useMobileChat('conversation-1'));
        act(() => third.result.current.handleInputChange('Still editable'));
        expect(third.result.current.newMessage).toBe('Still editable');
        await waitFor(() => expect(third.result.current.loading).toBe(false));
    });

    it('persists failures, preserves newer edits during send and clears only the successfully sent draft', async () => {
        let finish!: (value: Response) => void;
        const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/messages')
            ? new Promise<Response>(resolve => { finish = resolve; }) : response(200, conversation));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation).not.toBeNull());
        const key = mobileDraftKey(user.id, account.id, 'conversation-1')!;
        act(() => result.current.handleInputChange('Original'));
        let sending!: Promise<void>;
        act(() => { sending = result.current.handleSend(); });
        await act(async () => { finish(response(500)); await sending; });
        expect(JSON.parse(localStorage.getItem(key)!).content).toBe('Original');
        act(() => { sending = result.current.handleSend(); void result.current.handleSend(); });
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/messages'))).toHaveLength(2);
        act(() => result.current.handleInputChange('Newer'));
        await act(async () => { finish(response(200, { id: 'sent-1' })); await sending; });
        expect(result.current.newMessage).toBe('Newer');
        expect(JSON.parse(localStorage.getItem(key)!).content).toBe('Newer');
        act(() => { sending = result.current.handleSend(); });
        await act(async () => { finish(response(200, { id: 'sent-2' })); await sending; });
        expect(result.current.newMessage).toBe('');
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('stages/removes attachments and sends explicitly without consuming text or duplicating uploads', async () => {
        let finish!: (value: Response) => void;
        const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/message-with-attachments')
            ? new Promise<Response>(resolve => { finish = resolve; }) : response(200, conversation));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation).not.toBeNull());
        const file = new File(['private binary'], 'test.pdf');
        const event = { target: { files: [file], value: 'test.pdf' } } as unknown as React.ChangeEvent<HTMLInputElement>;
        act(() => result.current.handleInputChange('Independent draft'));
        act(() => result.current.handleFileUpload(event));
        expect(result.current.pendingAttachment).toBe(file);
        expect(event.target.value).toBe('');
        act(() => result.current.handleRemoveAttachment());
        expect(result.current.pendingAttachment).toBeNull();
        act(() => result.current.handleFileUpload(event));
        let uploading!: Promise<void>;
        act(() => { uploading = result.current.handleSendAttachment(); void result.current.handleSendAttachment(); });
        expect(result.current.isUploading).toBe(true);
        expect(result.current.attachmentUploadProgress).toBeNull();
        const uploads = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/message-with-attachments'));
        expect(uploads).toHaveLength(1);
        expect((uploads[0][1]?.body as FormData).get('content')).toBe('');
        await act(async () => { finish(response(200, { message: { id: 'attachment' } })); await uploading; });
        expect(result.current.pendingAttachment).toBeNull();
        expect(result.current.isUploading).toBe(false);
        expect(result.current.newMessage).toBe('Independent draft');
        expect(localStorage.getItem(mobileDraftKey(user.id, account.id, 'conversation-1')!)).not.toContain('private binary');
    });

    it('cleans up in-flight attachments on account switches and ignores late completion', async () => {
        let finish!: (value: Response) => void;
        let signal: AbortSignal | null | undefined;
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
            if (String(input).endsWith('/message-with-attachments')) {
                signal = init?.signal;
                return new Promise<Response>(resolve => { finish = resolve; });
            }
            return response(200, conversation);
        }));
        const { result, rerender } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation).not.toBeNull());
        act(() => result.current.handleFileUpload({ target: { files: [new File(['x'], 'x')] } } as unknown as React.ChangeEvent<HTMLInputElement>));
        let uploading!: Promise<void>;
        act(() => { uploading = result.current.handleSendAttachment(); });
        account = { id: 'account-2' };
        rerender();
        expect(signal?.aborted).toBe(true);
        expect(result.current.pendingAttachment).toBeNull();
        expect(result.current.isUploading).toBe(false);
        await act(async () => { finish(response(200, { message: { id: 'old-upload' } })); await uploading; });
        expect(result.current.messages).toEqual([]);
    });

    it('escapes existing plaintext when appending sanitized email HTML and retains customer details', async () => {
        const customer = { id: 'customer-1', firstName: 'Sam', email: 'sam@example.com', totalSpent: '42', ordersCount: 2 };
        vi.stubGlobal('fetch', vi.fn(async () => response(200, { ...conversation, wooCustomer: customer })));
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation).not.toBeNull());
        expect(result.current.conversation?.customer).toEqual(customer);
        expect(result.current.isRichText).toBe(true);
        act(() => result.current.handleInputChange('Price < 10 & > 2\nNext line'));
        act(() => result.current.handleSelectCanned({ id: 'reply', shortcut: 'r', content: '<p>Hello <b>Sam</b></p><script>bad()</script>' }));
        expect(result.current.newMessage).toBe('<p>Price &lt; 10 &amp; &gt; 2<br>Next line</p><p>Hello <b>Sam</b></p>');
    });

    it('keeps non-email canned and AI drafts plaintext', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input) => String(input).endsWith('/ai-draft')
            ? response(200, { draft: '<p>AI</p><p>Reply</p>' }) : response(200, { ...conversation, channel: 'CHAT' })));
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation).not.toBeNull());
        expect(result.current.isRichText).toBe(false);
        act(() => result.current.handleSelectCanned({ id: 'reply', shortcut: 'r', content: '<p>Hello <b>Sam</b></p><p>Thanks</p>' }));
        expect(result.current.newMessage).toBe('Hello Sam\n\nThanks');
        await act(async () => result.current.handleGenerateAIDraft());
        expect(result.current.newMessage).toBe('AI\n\nReply');
    });

    it('rejects empty email HTML and sends original HTML only on non-IME Ctrl/Cmd Enter', async () => {
        const fetchMock = vi.fn<typeof fetch>(async () => response(200, conversation));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useMobileChat('conversation-1'));
        await waitFor(() => expect(result.current.conversation).not.toBeNull());
        act(() => result.current.handleInputChange('<p><br></p>'));
        const before = fetchMock.mock.calls.length;
        await act(async () => result.current.handleSend());
        expect(fetchMock.mock.calls).toHaveLength(before);
        const html = '<p>Hello <strong>Sam</strong></p>';
        act(() => result.current.handleInputChange(html));
        const preventDefault = vi.fn();
        for (const nativeEvent of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
            act(() => result.current.handleKeyPress({ key: 'Enter', ctrlKey: true, nativeEvent, preventDefault } as unknown as React.KeyboardEvent));
        }
        expect(preventDefault).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls).toHaveLength(before);
        await act(async () => result.current.handleKeyPress({ key: 'Enter', metaKey: true, nativeEvent: { isComposing: false }, preventDefault } as unknown as React.KeyboardEvent));
        expect(preventDefault).toHaveBeenCalledOnce();
        const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/messages'));
        expect(JSON.parse(String(calls[0][1]?.body)).content).toBe(html);
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
