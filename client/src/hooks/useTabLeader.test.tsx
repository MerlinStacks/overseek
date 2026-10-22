import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTabLeader } from './useTabLeader';
class Channel {
    static instances: Channel[] = [];
    onmessage: ((event: any) => void) | null = null;
    postMessage = vi.fn(); close = vi.fn();
    constructor(public name: string) { Channel.instances.push(this); }
}
beforeEach(() => { vi.useFakeTimers(); Channel.instances = []; vi.stubGlobal('BroadcastChannel', Channel); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('isolates sibling instances and abandons callbacks after channel changes', async () => {
    const first = renderHook(({ channel }) => useTabLeader(channel), { initialProps: { channel: 'one' } });
    const second = renderHook(() => useTabLeader('one'));
    expect(first.result.current.tabId).not.toBe(second.result.current.tabId);
    const old = Channel.instances[0], callback = old.onmessage!;
    first.rerender({ channel: 'two' });
    expect(first.result.current.isLeader).toBe(false);
    expect(old.close).toHaveBeenCalledOnce();
    act(() => callback({ data: { type: 'claim', tabId: 'a', timestamp: Date.now() } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(first.result.current.isLeader).toBe(true);
});
it('rejects malformed/future messages and expires peers by local receive time', async () => {
    const view = renderHook(() => useTabLeader('one'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const channel = Channel.instances[0];
    for (const data of [null, {}, { type: 'heartbeat', tabId: 'a', timestamp: Date.now() + 999999999 }]) act(() => channel.onmessage!({ data }));
    expect(view.result.current.isLeader).toBe(true);
    act(() => channel.onmessage!({ data: { type: 'heartbeat', tabId: 'a', timestamp: Date.now() } }));
    expect(view.result.current.isLeader).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(view.result.current.isLeader).toBe(true);
});
