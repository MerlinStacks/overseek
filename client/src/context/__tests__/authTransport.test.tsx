import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from '../AuthContext';
import { AccountProvider, useAccount } from '../AccountContext';
import { api } from '../../services/api';

const user = { id: 'user-1', email: 'test@example.com', fullName: 'Test' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
};
function AuthWrapper({ children }: { children: ReactNode }) {
    return <AuthProvider>{children}</AuthProvider>;
}
function AccountWrapper({ children }: { children: ReactNode }) {
    return <AuthProvider><AccountProvider>{children}</AccountProvider></AuthProvider>;
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('token', 'old-token');
    localStorage.setItem('refreshToken', 'old-refresh');
    localStorage.setItem('user', JSON.stringify(user));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('coordinated auth transport', () => {
    it('does not mistake a profile update for a replacement session during refresh', async () => {
        const refresh = deferred<Response>();
        vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
            if (url === '/api/auth/refresh') return refresh.promise;
            return new Headers(options?.headers).get('Authorization') === 'Bearer new-token' ? json({ ok: true }) : json({}, 401);
        }));
        const { result } = renderHook(useAuth, { wrapper: AuthWrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        const request = api.get('/api/test', 'old-token');
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/refresh', expect.anything()));
        act(() => result.current.updateUser({ ...user, fullName: 'Updated name' }));
        await act(async () => {
            refresh.resolve(json({ accessToken: 'new-token', refreshToken: 'new-refresh' }));
            expect(await request).toEqual({ ok: true });
        });
        expect(result.current.user?.fullName).toBe('Updated name');
        expect(result.current.token).toBe('new-token');
    });

    it('shares bootstrap refresh with API recovery and does not restore the bootstrap user after logout', async () => {
        const expiredToken = `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`;
        localStorage.setItem('token', expiredToken);
        const refresh = deferred<Response>();
        const fetchMock = vi.fn(async (url: string) => url === '/api/auth/refresh' ? refresh.promise : json({}, 401));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(useAuth, { wrapper: AuthWrapper });
        await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1));
        const request = api.get('/api/test', expiredToken);
        const rejected = expect(request).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        act(() => result.current.logout());
        await act(async () => {
            refresh.resolve(json({ accessToken: 'late-token', refreshToken: 'late-refresh' }));
            await rejected;
        });
        expect(result.current.user).toBeNull();
        expect(result.current.token).toBeNull();
        expect(result.current.isLoading).toBe(false);
        expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1);
    });

    it('retries a stale 401 with an already rotated token without refreshing again', async () => {
        const original = deferred<Response>();
        const fetchMock = vi.fn().mockReturnValueOnce(original.promise).mockResolvedValueOnce(json({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        renderHook(useAuth, { wrapper: AuthWrapper });
        const request = api.get('/api/test', 'old-token');
        localStorage.setItem('token', 'new-token');
        original.resolve(json({}, 401));
        expect(await request).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer new-token');
    });

    it('adopts another tab\'s refresh without sending a competing refresh', async () => {
        localStorage.setItem('auth:refresh-lock', JSON.stringify({ owner: 'other-tab', expiresAt: Date.now() + 15000 }));
        const fetchMock = vi.fn(async (_url: string, options?: RequestInit) =>
            new Headers(options?.headers).get('Authorization') === 'Bearer new-token' ? json({ ok: true }) : json({}, 401));
        vi.stubGlobal('fetch', fetchMock);
        renderHook(useAuth, { wrapper: AuthWrapper });
        const request = api.get('/api/test', 'old-token');
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        localStorage.setItem('token', 'new-token');
        localStorage.setItem('refreshToken', 'new-refresh');
        await act(async () => { expect(await request).toEqual({ ok: true }); });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.every(([url]) => url !== '/api/auth/refresh')).toBe(true);
    });

    it('clears the session when the refresh token is rejected', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
        const { result } = renderHook(useAuth, { wrapper: AuthWrapper });
        await act(async () => { await expect(api.get('/api/test', 'old-token')).rejects.toMatchObject({ status: 401 }); });
        expect(result.current.token).toBeNull();
        expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('shares one refresh for concurrent 401s and preserves request options on retry', async () => {
        const refresh = deferred<Response>();
        const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
            if (url === '/api/auth/refresh') return refresh.promise;
            return new Headers(options?.headers).get('Authorization') === 'Bearer new-token'
                ? json({ ok: true }) : json({}, 401);
        });
        vi.stubGlobal('fetch', fetchMock);
        renderHook(useAuth, { wrapper: AuthWrapper });
        const first = api.post('/api/test', { value: 1 }, 'old-token', 'account-1');
        const second = api.get('/api/test', 'old-token');
        await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1));
        await act(async () => {
            refresh.resolve(json({ accessToken: 'new-token', refreshToken: 'new-refresh' }));
            expect(await first).toEqual({ ok: true });
            expect(await second).toEqual({ ok: true });
        });
        const retry = fetchMock.mock.calls.find(([, config]) => config?.method === 'POST' &&
            new Headers(config.headers).get('Authorization') === 'Bearer new-token')?.[1];
        expect(retry?.body).toBe('{"value":1}');
        expect(new Headers(retry?.headers).get('X-Account-ID')).toBe('account-1');
    });

    it.each([503, 429, 'network', 'malformed'])('keeps the session on transient refresh failure: %s', async failure => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url !== '/api/auth/refresh') return json({}, 401);
            if (failure === 'network') throw new TypeError('offline');
            if (failure === 'malformed') return json({});
            return json({}, failure);
        }));
        const { result } = renderHook(useAuth, { wrapper: AuthWrapper });
        await act(async () => {
            await expect(api.get('/api/test', 'old-token')).rejects.toMatchObject({ code: 'AUTH_REFRESH_UNAVAILABLE', isRecoverable: true });
        });
        expect(localStorage.getItem('token')).toBe('old-token');
        expect(result.current.token).toBe('old-token');
    });

    it.each(['logout', 'replacement'])('does not apply a late refresh after %s', async action => {
        const refresh = deferred<Response>();
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/refresh' ? refresh.promise : json({}, 401)));
        const { result } = renderHook(useAuth, { wrapper: AuthWrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        const request = api.get('/api/test', 'old-token');
        const rejected = expect(request).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/refresh', expect.anything()));
        act(() => action === 'logout' ? result.current.logout() : result.current.login('replacement', user, 'replacement-refresh'));
        await act(async () => {
            refresh.resolve(json({ accessToken: 'late-token', refreshToken: 'late-refresh' }));
            await rejected;
        });
        expect(localStorage.getItem('token')).toBe(action === 'logout' ? null : 'replacement');
        expect(result.current.token).toBe(action === 'logout' ? null : 'replacement');
    });

    it('bounds auth retry to one and expires a rejected refreshed session', async () => {
        const fetchMock = vi.fn(async (url: string) => url === '/api/auth/refresh'
            ? json({ accessToken: 'new-token', refreshToken: 'new-refresh' }) : json({}, 401));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(useAuth, { wrapper: AuthWrapper });
        await act(async () => { await expect(api.get('/api/test', 'old-token')).rejects.toMatchObject({ status: 401 }); });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result.current.token).toBeNull();
    });

    it('does not log out for an unauthenticated 401', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
        renderHook(useAuth, { wrapper: AuthWrapper });
        await expect(api.post('/api/auth/login', {})).rejects.toMatchObject({ status: 401 });
        expect(localStorage.getItem('token')).toBe('old-token');
    });
});

describe('account hydration', () => {
    it('ignores a late account response after logout', async () => {
        const accounts = deferred<Response>();
        vi.stubGlobal('fetch', vi.fn(() => accounts.promise));
        const { result } = renderHook(() => ({ auth: useAuth(), account: useAccount() }), { wrapper: AccountWrapper });
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/accounts', expect.anything()));
        act(() => result.current.auth.logout());
        await act(async () => { accounts.resolve(json([{ id: 'late-account' }])); });
        expect(result.current.account.accounts).toEqual([]);
        expect(result.current.account.currentAccount).toBeNull();
        expect(result.current.account.hasLoaded).toBe(false);
    });

    it.each(['server', 'network', 'malformed'])('exposes %s failures rather than successful empty accounts, and supports retry', async failure => {
        let fail = true;
        vi.stubGlobal('fetch', vi.fn(async () => {
            if (!fail) return json([]);
            if (failure === 'network') throw new TypeError('offline');
            return failure === 'server' ? json({}, 503) : json({ accounts: [] });
        }));
        const { result } = renderHook(useAccount, { wrapper: AccountWrapper });
        await waitFor(() => expect(result.current.loadError).toBeTruthy());
        expect(result.current.isLoading).toBe(false);
        expect(result.current.hasLoaded).toBe(false);
        fail = false;
        await act(() => result.current.refreshAccounts());
        expect(result.current.loadError).toBeNull();
        expect(result.current.hasLoaded).toBe(true);
        expect(result.current.accounts).toEqual([]);
    });

    it('retains account identity during failed background hydration', async () => {
        const account = { id: 'a1', name: 'Store' };
        let fail = false;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me'
            ? json(user) : fail ? json({}, 503) : json([account])));
        const { result } = renderHook(useAccount, { wrapper: AccountWrapper });
        await waitFor(() => expect(result.current.currentAccount?.id).toBe('a1'));
        const previous = result.current.currentAccount;
        fail = true;
        await act(() => result.current.refreshAccounts());
        expect(result.current.currentAccount).toBe(previous);
        expect(result.current.loadError).toBeTruthy();
        expect(result.current.isLoading).toBe(false);
    });
});
