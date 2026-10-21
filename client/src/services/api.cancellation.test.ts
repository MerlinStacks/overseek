import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, registerAuthRefresh } from './api';
const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('token', 'old'); localStorage.setItem('user', JSON.stringify({ id: 'a' })); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });
describe('request cancellation', () => {
    it('does not fetch when already aborted', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(api.request('/api/test', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(fetchMock).not.toHaveBeenCalled();
    });
    it('cancels backoff immediately, clears its timer, and never retries', async () => {
        vi.useFakeTimers(); fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '60' } }));
        const controller = new AbortController(); const result = api.request('/api/test', { signal: controller.signal }); const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
        await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(1); controller.abort(); await rejection;
        expect(vi.getTimerCount()).toBe(0); expect(fetchMock).toHaveBeenCalledOnce();
    });
    it('cancels an adapter that ignores abort', async () => {
        fetchMock.mockReturnValue(new Promise(() => {})); const controller = new AbortController(); const result = api.request('/api/test', { signal: controller.signal }); controller.abort();
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    });
    it('cancels refresh waits without logging out or retrying a stale request', async () => {
        let resolve!: (value: 'expired') => void; const refresh = vi.fn(() => new Promise<'expired'>(r => { resolve = r; })); const unregister = registerAuthRefresh(refresh);
        fetchMock.mockResolvedValue(new Response('{}', { status: 401 })); const controller = new AbortController();
        try {
            const result = api.request('/api/test', { token: 'old', signal: controller.signal }); const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
            await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce()); controller.abort(); await rejection; resolve('expired'); await Promise.resolve();
            expect(localStorage.getItem('token')).toBe('old'); expect(fetchMock).toHaveBeenCalledOnce();
        } finally { unregister(); }
    });
    it('does not log out if aborted while parsing a 401 body', async () => {
        let started = false; const unregister = registerAuthRefresh(async () => 'expired');
        fetchMock.mockResolvedValue({ ok: false, status: 401, text: () => { started = true; return new Promise(() => {}); } });
        const controller = new AbortController();
        try {
            const result = api.request('/api/test', { token: 'old', signal: controller.signal }); const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
            await vi.waitFor(() => expect(started).toBe(true)); controller.abort(); await rejection; expect(localStorage.getItem('token')).toBe('old');
        } finally { unregister(); }
    });
});
