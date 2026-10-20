import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ socket: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), connected: true }, connected: true, account: { id: 'a' } }));
vi.mock('../context/SocketContext', () => ({ useSocket: () => ({ socket: mocks.socket, isConnected: mocks.connected }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', fullName: 'User' } }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
import { useCollaboration } from './useCollaboration';
const users = [{ userId: 'u', name: 'User', connectedAt: 1 }];
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); mocks.connected = true; mocks.socket.connected = true; mocks.account = { id: 'a' }; Object.defineProperty(document, 'hidden', { configurable: true, value: false }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('collaboration lifecycle', () => {
    it('registers before joining and cleans up listeners, intervals and membership', () => {
        const { unmount } = renderHook(() => useCollaboration('doc'));
        expect(mocks.socket.on.mock.invocationCallOrder[0]).toBeLessThan(mocks.socket.emit.mock.invocationCallOrder[0]);
        act(() => vi.advanceTimersByTime(30000)); expect(mocks.socket.emit).toHaveBeenCalledWith('presence:heartbeat', { docId: 'doc' });
        unmount(); expect(vi.getTimerCount()).toBe(0); expect(mocks.socket.emit).toHaveBeenLastCalledWith('leave:document', { docId: 'doc' });
        expect(mocks.socket.off).toHaveBeenCalledWith('presence:sync', expect.any(Function));
    });
    it('clears presence immediately on document/account changes and ignores removed listeners', () => {
        const { result, rerender } = renderHook(({ id }) => useCollaboration(id), { initialProps: { id: 'doc' } });
        const sync = mocks.socket.on.mock.calls[0][1]; act(() => sync(users)); expect(result.current.activeUsers).toEqual(users);
        rerender({ id: 'next' }); expect(result.current.activeUsers).toEqual([]);
        act(() => sync(users)); expect(result.current.activeUsers).toEqual([]);
        act(() => mocks.socket.on.mock.calls[1][1](users)); expect(result.current.activeUsers).toEqual(users);
        mocks.account = { id: 'b' }; rerender({ id: 'next' }); expect(result.current.activeUsers).toEqual([]);
    });
    it('does not buffer leaves on disconnect, and rejoins on reconnect', () => {
        const { result, rerender } = renderHook(() => useCollaboration('doc'));
        act(() => mocks.socket.on.mock.calls[0][1](users));
        mocks.connected = false; mocks.socket.connected = false; rerender(); expect(result.current.activeUsers).toEqual([]);
        expect(mocks.socket.emit).not.toHaveBeenCalledWith('leave:document', expect.anything());
        mocks.connected = true; mocks.socket.connected = true; rerender();
        expect(mocks.socket.emit.mock.calls.filter(call => call[0] === 'join:document')).toHaveLength(2);
    });
    it('stops hidden heartbeats and rejoins on visibility return without duplicate timers', () => {
        renderHook(() => useCollaboration('doc'));
        Object.defineProperty(document, 'hidden', { configurable: true, value: true }); act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(vi.getTimerCount()).toBe(0);
        Object.defineProperty(document, 'hidden', { configurable: true, value: false }); act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(mocks.socket.emit.mock.calls.filter(call => call[0] === 'join:document')).toHaveLength(2); expect(vi.getTimerCount()).toBe(1);
        act(() => document.dispatchEvent(new Event('visibilitychange'))); expect(vi.getTimerCount()).toBe(1);
    });
});
