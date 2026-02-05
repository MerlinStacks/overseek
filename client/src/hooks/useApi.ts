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
 * Reason why the API hook is not ready to make requests.
 * Used to provide user-friendly feedback instead of silent failures.
 */
export type ApiNotReadyReason = 'no_token' | 'no_account' | null;

/**
 * Hook providing API methods with automatic auth and account context.
 * 
 * @example
 * const { get, post, isReady, notReadyReason } = useApi();
 * 
 * if (!isReady) {
 *   return <Alert>{notReadyReason === 'no_account' ? 'Please select an account' : 'Please log in'}</Alert>;
 * }
 * 
 * const data = await get<Order[]>('/api/orders');
 * await post('/api/orders/123/note', { content: 'Note text' });
 */
export function useApi() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const accountId = currentAccount?.id;

    // EDGE CASE: Provide clear reason when API calls would fail
    // This prevents silent failures and enables actionable user feedback
    const notReadyReason: ApiNotReadyReason = !token
        ? 'no_token'
        : !accountId
            ? 'no_account'
            : null;

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
         * Reason why the hook is not ready.
         * - 'no_token': User is not authenticated
         * - 'no_account': User hasn't selected an account
         * - null: Ready to make requests
         */
        notReadyReason,

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

