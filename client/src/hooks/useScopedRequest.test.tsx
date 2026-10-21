import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScopedRequest } from './useScopedRequest';
const decode = (value: unknown) => { if (typeof value !== 'string') throw new Error('Invalid data'); return value; };
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('scoped request lifecycle', () => {
    it('aborts on unmount and ignores late responses', async () => {
        let resolve!: (value: unknown) => void; fetchMock.mockReturnValue(new Promise(r => { resolve = r; }));
        const { result, unmount } = renderHook(() => useScopedRequest('/api/resource', 'account', 'token', decode));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); const signal = fetchMock.mock.calls[0][1].signal; unmount();
        await act(async () => { resolve({ ok: true, json: async () => 'Private result' }); }); expect(signal.aborted).toBe(true); expect(result.current.data).toBeNull();
    });
    it('turns a request timeout into a retryable error', async () => {
        vi.useFakeTimers(); fetchMock.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))));
        const { result, unmount } = renderHook(() => useScopedRequest('/api/resource', 'account', 'token', decode));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { vi.advanceTimersByTime(30000); }); expect(result.current.error).toBe(true); expect(result.current.loading).toBe(false);
        unmount(); expect(vi.getTimerCount()).toBe(0);
    });
});
