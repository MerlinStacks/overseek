
export interface RequestOptions extends RequestInit {
    token?: string;
    accountId?: string;
}

/**
 * Enhanced API Error with structured data from server.
 * Includes error code and recoverability for better client handling.
 */
export class ApiError extends Error {
    /** HTTP status code */
    readonly status: number;
    /** Error code for client-side handling */
    readonly code: string;
    /** Whether the error is recoverable (user can retry) */
    readonly isRecoverable: boolean;

    constructor(
        status: number,
        message: string,
        code: string = 'INTERNAL_ERROR',
        isRecoverable: boolean = false
    ) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.isRecoverable = isRecoverable;
    }
}

/**
 * Global handler for auth failures (401).
 * Clears stored credentials and redirects to login.
 * Uses a debounce to avoid multiple simultaneous redirects.
 */
let isHandlingAuthError = false;
function handleAuthError(message: string) {
    if (isHandlingAuthError) return;
    isHandlingAuthError = true;

    // Clear stored auth data
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('refreshToken');

    // Show notification (if toast system exists, it will pick this up)
    const errorMessages = ['Invalid token', 'invalid signature', 'Token expired', 'jwt expired'];
    const isSignatureError = errorMessages.some(msg => message.toLowerCase().includes(msg.toLowerCase()));

    // Store message for login page to show
    if (isSignatureError) {
        sessionStorage.setItem('authError', 'Your session has expired. Please log in again.');
    }

    // Redirect to login (avoid if already on login page)
    if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
    }

    // Reset debounce after redirect
    setTimeout(() => { isHandlingAuthError = false; }, 2000);
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { token, accountId, headers, body, ...customConfig } = options;

    // Detect user's timezone for timezone-aware analytics
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';

    const config: RequestInit = {
        ...customConfig,
        body,
        headers: {
            // Only set Content-Type for requests with a body
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(accountId ? { 'X-Account-ID': accountId } : {}),
            'x-timezone': userTimezone,
            ...headers,
        },
    };

    const response = await fetch(endpoint, config);

    if (!response.ok) {
        let errorMessage = 'Something went wrong';
        let errorCode = 'INTERNAL_ERROR';
        let isRecoverable = false;

        try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
            errorCode = errorData.code || errorCode;
            isRecoverable = errorData.isRecoverable || false;
        } catch {
            // Only use status text if JSON parsing fails
            errorMessage = response.statusText;
        }

        // Handle auth errors globally - auto logout and redirect
        if (response.status === 401) {
            handleAuthError(errorMessage);
        }

        throw new ApiError(response.status, errorMessage, errorCode, isRecoverable);
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

    /**
     * Generic request method for valid scenarios not covered by the helpers above.
     * Useful for custom headers or other fetch options.
     */
    request: <T>(endpoint: string, options: RequestOptions = {}) =>
        request<T>(endpoint, options)
};
