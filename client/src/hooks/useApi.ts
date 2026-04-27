
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

    const get = useCallback(
        <T>(endpoint: string) => api.get<T>(endpoint, token || undefined, accountId),
        [token, accountId]
    );

    const post = useCallback(
        <T>(endpoint: string, data?: unknown) => api.post<T>(endpoint, data, token || undefined, accountId),
        [token, accountId]
    );

    const patch = useCallback(
        <T>(endpoint: string, data?: unknown) => api.patch<T>(endpoint, data, token || undefined, accountId),
        [token, accountId]
    );

    const put = useCallback(
        <T>(endpoint: string, data?: unknown) => api.put<T>(endpoint, data, token || undefined, accountId),
        [token, accountId]
    );

    const del = useCallback(
        <T>(endpoint: string) => api.delete<T>(endpoint, token || undefined, accountId),
        [token, accountId]
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
