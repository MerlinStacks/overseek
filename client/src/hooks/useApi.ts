

import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { api } from '../services/api';

/** auto-attaches auth token + account ID to every request */
export function useApi() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const accountId = currentAccount?.id;

    return {

        get: <T>(endpoint: string) =>
            api.get<T>(endpoint, token || undefined, accountId),


        post: <T>(endpoint: string, data?: any) =>
            api.post<T>(endpoint, data, token || undefined, accountId),


        patch: <T>(endpoint: string, data?: any) =>
            api.patch<T>(endpoint, data, token || undefined, accountId),


        put: <T>(endpoint: string, data?: any) =>
            api.put<T>(endpoint, data, token || undefined, accountId),


        delete: <T>(endpoint: string) =>
            api.delete<T>(endpoint, token || undefined, accountId),


        isReady: Boolean(token && accountId),


        accountId,


        token,
    };
}
