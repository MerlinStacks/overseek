import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ token: 'token' as string | null, account: { id: 'a' } as { id: string } | null, request: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: m.token }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../services/api', () => ({ api: { request: m.request } }));
import { useApi } from './useApi';
beforeEach(() => { vi.clearAllMocks(); m.token = 'token'; m.account = { id: 'a' }; m.request.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
describe('account API helpers', () => {
    it('keeps callbacks stable and supplies scope and cancellation for all methods', async () => {
        const { result, rerender } = renderHook(useApi); const previous = result.current; rerender(); expect(result.current).toBe(previous);
        const signal = new AbortController().signal;
        await result.current.get('/test', { signal }); await result.current.delete('/test', { signal });
        for (const method of ['post', 'put', 'patch'] as const) await result.current[method]('/test', { value: 0 }, { signal });
        expect(m.request).toHaveBeenCalledTimes(5);
        for (const [, options] of m.request.mock.calls) expect(options).toMatchObject({ token: 'token', accountId: 'a', signal });
        expect(m.request.mock.calls[2][1]).toMatchObject({ method: 'POST', body: '{"value":0}' });
    });
    it.each(['auth', 'account'])('refuses requests without %s', async missing => {
        if (missing === 'auth') m.token = null; else m.account = null;
        const { result } = renderHook(useApi); expect(result.current.isReady).toBe(false);
        await expect(result.current.get('/test')).rejects.toThrow('Sign in and select'); await expect(result.current.post('/test')).rejects.toThrow(); expect(m.request).not.toHaveBeenCalled();
    });
});
