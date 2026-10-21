
import { useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { api } from '../services/api';

/**
 * Auto-attaches auth token + account ID to every request.
 *
 * Why useMemo/useCallback: Without stable references, every component
 * that destructures `get`/`post`/`put` from this hook would see new
 * function identities per render. This breaks useCallback/useEffect
 * dependency arrays downstream (e.g. CAPISettings fetchConfigs loop).
 */
export function useApi() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const accountId = currentAccount?.id;
    const request = useCallback(async <T,>(endpoint: string, method: string, data?: unknown, options?: { signal?: AbortSignal }) => {
        if (!token || !accountId) throw new Error('Sign in and select an account before making this request.');
        return api.request<T>(endpoint, { method, token, accountId, signal: options?.signal, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    }, [token, accountId]);

    const get = useCallback(
        <T>(endpoint: string, options?: { signal?: AbortSignal }) => request<T>(endpoint, 'GET', undefined, options),
        [request]
    );

    const post = useCallback(
        <T>(endpoint: string, data?: unknown, options?: { signal?: AbortSignal }) => request<T>(endpoint, 'POST', data, options),
        [request]
    );

    const patch = useCallback(
        <T>(endpoint: string, data?: unknown, options?: { signal?: AbortSignal }) => request<T>(endpoint, 'PATCH', data, options),
        [request]
    );

    const put = useCallback(
        <T>(endpoint: string, data?: unknown, options?: { signal?: AbortSignal }) => request<T>(endpoint, 'PUT', data, options),
        [request]
    );

    const del = useCallback(
        <T>(endpoint: string, options?: { signal?: AbortSignal }) => request<T>(endpoint, 'DELETE', undefined, options),
        [request]
    );

    const isReady = Boolean(token && accountId);

    return useMemo(() => ({
        get,
        post,
        patch,
        put,
        delete: del,
        isReady,
        accountId,
        token,
    }), [get, post, patch, put, del, isReady, accountId, token]);
}
