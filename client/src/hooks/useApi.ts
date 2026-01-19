/**
 * useApi Hook
 * 
 * Centralized API hook that automatically includes auth token and account ID headers.
 * Eliminates inconsistent header casing and manual header management across components.
 */

import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { api } from '../services/api';

/**
 * Hook providing API methods with automatic auth and account context.
 * 
 * @example
 * const { get, post } = useApi();
 * const data = await get<Order[]>('/api/orders');
 * await post('/api/orders/123/note', { content: 'Note text' });
 */
export function useApi() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const accountId = currentAccount?.id;

    return {
        /**
         * GET request with auth headers
         */
        get: <T>(endpoint: string) =>
            api.get<T>(endpoint, token || undefined, accountId),

        /**
         * POST request with auth headers
         */
        post: <T>(endpoint: string, data?: any) =>
            api.post<T>(endpoint, data, token || undefined, accountId),

        /**
         * PATCH request with auth headers
         */
        patch: <T>(endpoint: string, data?: any) =>
            api.patch<T>(endpoint, data, token || undefined, accountId),

        /**
         * PUT request with auth headers
         */
        put: <T>(endpoint: string, data?: any) =>
            api.put<T>(endpoint, data, token || undefined, accountId),

        /**
         * DELETE request with auth headers
         */
        delete: <T>(endpoint: string) =>
            api.delete<T>(endpoint, token || undefined, accountId),

        /**
         * Check if the hook is ready (has token and account)
         */
        isReady: Boolean(token && accountId),

        /**
         * Current account ID (for components that need it explicitly)
         */
        accountId,

        /**
         * Current auth token (for components that need it explicitly)
         */
        token,
    };
}
