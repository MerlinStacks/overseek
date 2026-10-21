import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ connected: true, user: { id: 'self', fullName: 'Agent', email: 'agent@test', avatarUrl: null }, handlers: new Map<string, (value: unknown) => void>(), emit: vi.fn() }));
const socket = { connected: true, on: (event: string, handler: (value: unknown) => void) => m.handlers.set(event, handler), off: (event: string) => m.handlers.delete(event), emit: m.emit };
vi.mock('../context/SocketContext', () => ({ useSocket: () => ({ socket, isConnected: m.connected }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: m.user }) }));
import { useConversationPresence } from './useConversationPresence';
import { useLoadingTimeout } from './useLoadingTimeout';
import { useRelativeTime } from './useRelativeTime';
beforeEach(() => { vi.clearAllMocks(); m.handlers.clear(); m.connected = true; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('conversation-scoped presence', () => {
    it('validates tagged events, clears on switches, and rejects stale callbacks', () => {
        const { result, rerender } = renderHook(({ id }) => useConversationPresence(id), { initialProps: { id: 'a' as string | null } });
        const previous = m.handlers.get('conversation:viewers')!;
        act(() => previous({ conversationId: 'a', viewers: [{ userId: 'other', name: 'Other', connectedAt: 0 }] })); expect(result.current.hasOtherViewers).toBe(true);
        rerender({ id: 'b' }); expect(result.current.viewers).toEqual([]);
        act(() => { previous({ conversationId: 'a', viewers: [{ userId: 'old', name: 'Old', connectedAt: 0 }] }); m.handlers.get('conversation:viewers')!({ conversationId: 'a', viewers: [] }); m.handlers.get('conversation:viewers')!({ conversationId: 'b', viewers: [{}] }); }); expect(result.current.viewers).toEqual([]);
        rerender({ id: null }); expect(result.current.viewers).toEqual([]); expect(m.handlers.has('conversation:viewers')).toBe(false);
    });
    it('rejoins on reconnect and sends heartbeats only while subscribed', () => {
        vi.useFakeTimers(); const { rerender, unmount } = renderHook(() => useConversationPresence('a'));
        act(() => vi.advanceTimersByTime(20000)); expect(m.emit).toHaveBeenCalledWith('presence:heartbeat', { docId: 'conv:a' });
        m.connected = false; rerender(); expect(vi.getTimerCount()).toBe(0); m.connected = true; rerender();
        expect(m.emit.mock.calls.filter(([event]) => event === 'join:conversation')).toHaveLength(2); unmount(); expect(vi.getTimerCount()).toBe(0);
    });
});
describe('safe timing hooks', () => {
    it('masks an expired warning immediately when loading stops and gives a new deadline its own cycle', () => {
        vi.useFakeTimers(); const { result, rerender } = renderHook(props => useLoadingTimeout(props), { initialProps: { isLoading: true, timeoutMs: 1000 } });
        act(() => vi.advanceTimersByTime(1000)); expect(result.current.hasTimedOut).toBe(true);
        rerender({ isLoading: false, timeoutMs: 1000 }); expect(result.current.message).toBe(''); expect(result.current.hasTimedOut).toBe(false);
        rerender({ isLoading: true, timeoutMs: 2000 }); expect(result.current.hasTimedOut).toBe(false); act(() => vi.advanceTimersByTime(2000)); expect(result.current.hasTimedOut).toBe(true);
        rerender({ isLoading: true, timeoutMs: 5000 }); expect(result.current.hasTimedOut).toBe(false);
    });
    it('does not crash on invalid dates or schedule intervals for them', () => {
        vi.useFakeTimers(); const { result, rerender } = renderHook(({ date, interval }) => useRelativeTime(date, interval), { initialProps: { date: 'invalid', interval: NaN } });
        expect(result.current).toBe(''); expect(vi.getTimerCount()).toBe(0);
        rerender({ date: '2026-10-21T00:00:00Z', interval: 0 }); expect(vi.getTimerCount()).toBe(1);
    });
});
