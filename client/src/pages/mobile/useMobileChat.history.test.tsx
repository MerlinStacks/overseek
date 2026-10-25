import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => {
    const listeners = new Map<string, (payload: unknown) => void>();
    return { account: { id: 'account' }, user: { id: 'agent' }, listeners, socket: {
        emit: vi.fn(), on: vi.fn((event, handler) => listeners.set(event, handler)), off: vi.fn(event => listeners.delete(event)),
    } };
});
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: m.user }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/SocketContext', () => ({ useSocket: () => ({ socket: m.socket }) }));
vi.mock('../../hooks/useCannedResponses', () => ({ useCannedResponses: () => ({ setShowCanned: vi.fn() }) }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));
import { useMobileChat } from './useMobileChat';

const latest = { id: 'latest', content: 'Latest', senderType: 'AGENT', createdAt: '2026-01-02T00:00:00Z' };
const detail = { id: 'thread', channel: 'EMAIL', guestEmail: 'customer@example.com', messages: [latest], hasMoreMessages: true, nextMessageCursor: 'cursor-1' };
const response = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body }) as Response;
beforeEach(() => { m.account = { id: 'account' }; m.listeners.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('preserves internal-note and scheduled-message metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...detail, messages: [
        { ...latest, isInternal: true, scheduledFor: '2099-01-01T00:00:00Z' },
    ] })));
    const { result } = renderHook(() => useMobileChat('thread'));
    await waitFor(() => expect(result.current.messages[0]).toMatchObject({ isInternal: true, scheduledFor: '2099-01-01T00:00:00Z' }));
});

it('prepends older history once, deduplicates, preserves scroll position and advances the cursor', async () => {
    const fetch = vi.fn(async input => response(String(input).includes('before=') ? {
        messages: [{ ...latest, id: 'old', content: 'Older', createdAt: '2026-01-01T00:00:00Z' }, latest], hasMoreMessages: false, nextMessageCursor: null,
    } : detail));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMobileChat('thread'));
    await waitFor(() => expect(result.current.hasMoreMessages).toBe(true));
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { get: vi.fn().mockReturnValueOnce(100).mockReturnValue(200) });
    container.scrollTop = 20;
    result.current.messagesContainerRef.current = container;
    await act(async () => result.current.loadOlderMessages());
    expect(result.current.messages.map(message => message.id)).toEqual(['old', 'latest']);
    expect(result.current.hasMoreMessages).toBe(false);
    expect(fetch).toHaveBeenCalledWith('/api/chat/thread?limit=100&before=cursor-1', expect.anything());
    // No jump to the bottom when history is prepended.
    expect(container.scrollTop).toBe(120);
});

it('keeps existing messages and cursor on history failure so loading can be retried', async () => {
    vi.stubGlobal('fetch', vi.fn(async input => String(input).includes('before=') ? response({}, 500) : response(detail)));
    const { result } = renderHook(() => useMobileChat('thread'));
    await waitFor(() => expect(result.current.hasMoreMessages).toBe(true));
    await act(async () => result.current.loadOlderMessages());
    expect(result.current.messages.map(message => message.id)).toEqual(['latest']);
    expect(result.current.historyError).toContain('Could not load older messages');
    expect(result.current.hasMoreMessages).toBe(true);
    expect(result.current.isLoadingOlderMessages).toBe(false);
});

it('ignores older-history responses after switching accounts', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async input => String(input).includes('before=') ? new Promise<Response>(resolve => { finish = resolve; }) : response(detail)));
    const { result, rerender } = renderHook(() => useMobileChat('thread'));
    await waitFor(() => expect(result.current.hasMoreMessages).toBe(true));
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadOlderMessages(); });
    m.account = { id: 'other-account' };
    rerender();
    await act(async () => { finish(response({ messages: [{ ...latest, id: 'foreign' }] })); await pending; });
    expect(result.current.messages.some(message => message.id === 'foreign')).toBe(false);
});

it('debounces live customer read receipts and cancels them when leaving the conversation', async () => {
    const fetch = vi.fn(async () => response(detail));
    vi.stubGlobal('fetch', fetch);
    const { result, unmount } = renderHook(() => useMobileChat('thread'));
    await waitFor(() => expect(result.current.conversation?.id).toBe('thread'));
    vi.useFakeTimers();
    const emit = (id: string) => m.listeners.get('message:new')!({ id, conversationId: 'thread', accountId: 'account', senderType: 'CUSTOMER', content: 'Hello' });
    act(() => { emit('one'); emit('two'); });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/read'))).toHaveLength(2);
    act(() => emit('three'));
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/read'))).toHaveLength(2);
});
