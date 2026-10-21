import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScopedMutation } from './useScopedMutation';
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('scoped mutation serialization', () => {
    it('releases pending state at the deadline even if a transport ignores abort', async () => {
        vi.useFakeTimers(); const { result } = renderHook(() => useScopedMutation());
        let operation!: ReturnType<typeof result.current.run>;
        await act(async () => { operation = result.current.run(() => new Promise(() => {}), 'Could not confirm update'); });
        await act(async () => { vi.advanceTimersByTime(30000); });
        await expect(operation).resolves.toEqual({ ok: false }); expect(result.current.busy).toBe(false); expect(result.current.error).toBe('Could not confirm update');
    });
    it('rejects duplicate work synchronously and aborts/clears timers on unmount', async () => {
        vi.useFakeTimers(); let signal!: AbortSignal;
        const task = vi.fn((value: AbortSignal) => { signal = value; return new Promise(() => {}); });
        const { result, unmount } = renderHook(() => useScopedMutation());
        await act(async () => { void result.current.run(task, 'Failed'); await expect(result.current.run(task, 'Failed')).resolves.toEqual({ ok: false }); });
        expect(task).toHaveBeenCalledOnce(); expect(result.current.busy).toBe(true); unmount(); expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    });
});
