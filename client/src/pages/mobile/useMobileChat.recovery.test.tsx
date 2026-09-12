import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileChat } from './useMobileChat';
import { mobileDraftKey, MOBILE_DRAFT_TTL } from './mobileChatDraft';

const account = { id: 'account-1' };
const user = { id: 'user-1' };
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

const key = mobileDraftKey(user.id, account.id, 'conversation-1')!;
const conversation = { id: 'conversation-1', status: 'OPEN', channel: 'EMAIL', messages: [] };
const response = (status: number, body: unknown = {}) => ({
    ok: status >= 200 && status < 300, status, json: async () => body,
}) as Response;
function deferred() {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>(finish => { resolve = finish; });
    return { promise, resolve };
}
async function mount() {
    const hook = renderHook(() => useMobileChat('conversation-1'));
    await waitFor(() => expect(hook.result.current.conversation?.id).toBe('conversation-1'));
    return hook;
}

describe('mobile text send recovery and AI races', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        let id = 0;
        vi.stubGlobal('crypto', { randomUUID: () => `request-${++id}` });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('persists identity before POST and retries an interrupted acknowledged-on-server send after remount', async () => {
        const firstResponse = deferred();
        const ids: string[] = [];
        let signal: AbortSignal | null | undefined;
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
            if (!String(url).endsWith('/messages')) return response(200, conversation);
            const body = JSON.parse(String(init?.body));
            ids.push(body.clientRequestId);
            expect(JSON.parse(localStorage.getItem(key)!).pending).toMatchObject({
                content: body.content, clientRequestId: body.clientRequestId,
            });
            if (ids.length === 1) { signal = init?.signal; return firstResponse.promise; }
            return response(200, { id: 'already-delivered', ...body });
        }));
        const first = await mount();
        act(() => first.result.current.handleInputChange('<p>Hello</p>'));
        let sending!: Promise<void>;
        act(() => { sending = first.result.current.handleSend(); });
        first.unmount();
        expect(signal?.aborted).toBe(true);
        const recovered = await mount();
        expect(recovered.result.current.newMessage).toBe('<p>Hello</p>');
        await act(async () => recovered.result.current.handleSend());
        expect(ids).toEqual(['mobile-conversation-1-request-1', 'mobile-conversation-1-request-1']);
        expect(localStorage.getItem(key)).toBeNull();
        act(() => recovered.result.current.handleInputChange('Next draft'));
        await act(async () => { firstResponse.resolve(response(200, { id: 'already-delivered' })); await sending; });
        expect(recovered.result.current.newMessage).toBe('Next draft');
        expect(JSON.parse(localStorage.getItem(key)!).content).toBe('Next draft');
    });

    it.each(['edit', 'canned', 'edit-back'] as const)('invalidates recovered identity on %s', async change => {
        const ids: string[] = [];
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
            if (!String(url).endsWith('/messages')) return response(200, conversation);
            ids.push(JSON.parse(String(init?.body)).clientRequestId);
            return response(502, { error: 'Failed' });
        }));
        const first = await mount();
        act(() => first.result.current.handleInputChange('Original'));
        await act(async () => first.result.current.handleSend());
        first.unmount();
        const recovered = await mount();
        act(() => {
            if (change === 'canned') recovered.result.current.handleSelectCanned({ id: 'reply', shortcut: 'r', content: 'New reply' });
            else recovered.result.current.handleInputChange('Newer');
        });
        if (change === 'edit-back') act(() => recovered.result.current.handleInputChange('Original'));
        expect(JSON.parse(localStorage.getItem(key)!).pending).toBeUndefined();
        recovered.unmount();
        const edited = await mount();
        await act(async () => edited.result.current.handleSend());
        expect(ids).toEqual(['mobile-conversation-1-request-1', 'mobile-conversation-1-request-2']);
    });

    it('restores failed send identity and expires pending identity independently of fresh draft text', async () => {
        const ids: string[] = [];
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
            if (!String(url).endsWith('/messages')) return response(200, conversation);
            ids.push(JSON.parse(String(init?.body)).clientRequestId);
            return response(502, { error: 'Failed' });
        }));
        const first = await mount();
        act(() => first.result.current.handleInputChange('Retry me'));
        await act(async () => first.result.current.handleSend());
        first.unmount();
        const recovered = await mount();
        await act(async () => recovered.result.current.handleSend());
        recovered.unmount();
        const saved = JSON.parse(localStorage.getItem(key)!);
        saved.pending.createdAt = Date.now() - MOBILE_DRAFT_TTL;
        localStorage.setItem(key, JSON.stringify(saved));
        const expired = await mount();
        expect(expired.result.current.newMessage).toBe('Retry me');
        await act(async () => expired.result.current.handleSend());
        expect(ids).toEqual(['mobile-conversation-1-request-1', 'mobile-conversation-1-request-1', 'mobile-conversation-1-request-2']);
        expired.unmount();
        saved.updatedAt = Date.now() - MOBILE_DRAFT_TTL;
        localStorage.setItem(key, JSON.stringify(saved));
        const stale = await mount();
        expect(stale.result.current.newMessage).toBe('');
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('keeps same-mount retry and successful clearing working when storage throws', async () => {
        for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
            vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('Unavailable'); });
        }
        const ids: string[] = [];
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
            if (!String(url).endsWith('/messages')) return response(200, conversation);
            ids.push(JSON.parse(String(init?.body)).clientRequestId);
            return response(ids.length === 1 ? 502 : 200, { id: 'sent' });
        }));
        const hook = await mount();
        act(() => hook.result.current.handleInputChange('Hello'));
        await act(async () => hook.result.current.handleSend());
        expect(hook.result.current.newMessage).toBe('Hello');
        await act(async () => hook.result.current.handleSend());
        expect(ids[0]).toBe(ids[1]);
        expect(hook.result.current.newMessage).toBe('');
    });

    it.each(['edit', 'edit-back', 'send', 'switch'] as const)('ignores AI completion after %s', async change => {
        const ai = deferred();
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async url => String(url).endsWith('/ai-draft')
            ? ai.promise : response(200, String(url).endsWith('/messages') ? { id: 'sent' } : conversation)));
        const hook = renderHook(({ id }) => useMobileChat(id), { initialProps: { id: 'conversation-1' } });
        await waitFor(() => expect(hook.result.current.conversation).not.toBeNull());
        act(() => hook.result.current.handleInputChange('Original'));
        let generating!: Promise<void>;
        act(() => { generating = hook.result.current.handleGenerateAIDraft(); });
        if (change === 'send') await act(async () => hook.result.current.handleSend());
        else if (change === 'switch') hook.rerender({ id: 'conversation-2' });
        else {
            act(() => hook.result.current.handleInputChange('Newer'));
            if (change === 'edit-back') act(() => hook.result.current.handleInputChange('Original'));
        }
        await act(async () => { ai.resolve(response(200, { draft: '<p>Late AI</p>' })); await generating; });
        const expected = change === 'edit' ? 'Newer' : change === 'edit-back' ? 'Original' : '';
        expect(hook.result.current.newMessage).toBe(expected);
        expect(hook.result.current.isGeneratingDraft).toBe(false);
        if (change === 'send') expect(localStorage.getItem(key)).toBeNull();
        else expect(JSON.parse(localStorage.getItem(key)!).content).toBe(change === 'switch' ? 'Original' : expected);
    });

    it('does not clear newer persisted content when a matching older send succeeds', async () => {
        const send = deferred();
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async url => String(url).endsWith('/messages')
            ? send.promise : response(200, conversation)));
        const hook = await mount();
        act(() => hook.result.current.handleInputChange('Original'));
        let sending!: Promise<void>;
        act(() => { sending = hook.result.current.handleSend(); });
        const newer = { content: 'Other tab', revision: 2, updatedAt: Date.now() };
        localStorage.setItem(key, JSON.stringify(newer));
        await act(async () => { send.resolve(response(200, { id: 'sent' })); await sending; });
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual(newer);
    });
});
