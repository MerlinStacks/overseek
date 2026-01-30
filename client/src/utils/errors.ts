/**
 * Client-side Error Utilities
 * 
 * Provides user-friendly error messages matching the server error taxonomy.
 */

/**
 * Error code to user-friendly message mapping.
 * Mirrors server-side FRIENDLY_MESSAGES for consistency.
 */
const FRIENDLY_MESSAGES: Record<string, string> = {
    // Authentication & Authorization
    'AUTHENTICATION_ERROR': 'Please log in to continue.',
    'AUTHORIZATION_ERROR': 'You don\'t have permission to do this.',

    // Rate Limiting
    'RATE_LIMIT_ERROR': 'Too many requests. Please wait a moment and try again.',

    // Resource Errors
    'NOT_FOUND': 'The requested item could not be found.',
    'CONFLICT_ERROR': 'This action conflicts with existing data.',
    'VALIDATION_ERROR': 'Please check your input and try again.',

    // AI Service
    'AI_SERVICE_ERROR': 'AI features are temporarily unavailable. Please try again.',
    'AI_RATE_LIMITED': 'AI service is busy. Please wait a moment and try again.',
    'AI_NOT_CONFIGURED': 'AI features are not available for this account.',

    // External Services
    'EXTERNAL_API_ERROR': 'A connected service is temporarily unavailable.',
    'SERVICE_UNAVAILABLE': 'This service is temporarily unavailable. Please try again later.',

    // Sync Errors
    'SYNC_ERROR': 'Sync failed. Please check your WooCommerce connection.',
    'WEBHOOK_ERROR': 'Webhook processing failed.',

    // Generic
    'INTERNAL_ERROR': 'Something went wrong. Please try again or contact support.',
};

/**
 * API Error with structured data from server
 */
export interface ApiErrorData {
    message: string;
    code?: string;
    isRecoverable?: boolean;
    context?: Record<string, unknown>;
}

/**
 * Gets a user-friendly message for an error code.
 */
export function getFriendlyMessage(code: string | undefined): string {
    if (!code) return FRIENDLY_MESSAGES['INTERNAL_ERROR'];
    return FRIENDLY_MESSAGES[code] || FRIENDLY_MESSAGES['INTERNAL_ERROR'];
}

/**
 * Extracts a user-friendly message from any error.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        // Check if it's our ApiError with code
        const apiError = error as any;
        if (apiError.code) {
            return getFriendlyMessage(apiError.code);
        }

        // Check for common error patterns
        const msg = error.message.toLowerCase();
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
            return 'Network error. Please check your connection and try again.';
        }
        if (msg.includes('timeout')) {
            return 'The request took too long. Please try again.';
        }

        return error.message;
    }

    return FRIENDLY_MESSAGES['INTERNAL_ERROR'];
}

/**
 * Checks if an error is recoverable (user can retry).
 */
export function isRecoverableError(error: unknown): boolean {
    if (error instanceof Error) {
        const apiError = error as any;
        if (typeof apiError.isRecoverable === 'boolean') {
            return apiError.isRecoverable;
        }
    }
    return false;
}
