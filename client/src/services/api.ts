import { Account } from '../context/AccountContext';

interface RequestOptions extends RequestInit {
    token?: string;
    accountId?: string;
}

class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { token, accountId, headers, ...customConfig } = options;

    const config: RequestInit = {
        ...customConfig,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(accountId ? { 'X-Account-ID': accountId } : {}),
            ...headers,
        },
    };

    const response = await fetch(endpoint, config);

    if (!response.ok) {
        let errorMessage = 'Something went wrong';
        try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
            // Only use status text if JSON parsing fails
            errorMessage = response.statusText;
        }
        throw new ApiError(response.status, errorMessage);
    }

    // Handle 204 No Content
    if (response.status === 204) {
        return {} as T;
    }

    return response.json();
}

export const api = {
    get: <T>(endpoint: string, token?: string, accountId?: string) =>
        request<T>(endpoint, { method: 'GET', token, accountId }),

    post: <T>(endpoint: string, data: any, token?: string, accountId?: string) =>
        request<T>(endpoint, { method: 'POST', body: JSON.stringify(data), token, accountId }),

    patch: <T>(endpoint: string, data: any, token?: string, accountId?: string) =>
        request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(data), token, accountId }),

    delete: <T>(endpoint: string, token?: string, accountId?: string) =>
        request<T>(endpoint, { method: 'DELETE', token, accountId }),

    put: <T>(endpoint: string, data: any, token?: string, accountId?: string) =>
        request<T>(endpoint, { method: 'PUT', body: JSON.stringify(data), token, accountId }),
};
