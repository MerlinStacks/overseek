/**
 * Custom Error Classes for Overseek
 * 
 * Structured error handling with context for better debugging and user feedback.
 */

// ============================================================================
// Base Error
// ============================================================================

export class OverseekError extends Error {
    /** HTTP status code */
    readonly statusCode: number;
    /** Error code for client handling */
    readonly code: string;
    /** Additional context for debugging */
    readonly context?: Record<string, unknown>;
    /** Whether this error is recoverable */
    readonly isRecoverable: boolean;

    constructor(
        message: string,
        options: {
            statusCode?: number;
            code?: string;
            context?: Record<string, unknown>;
            isRecoverable?: boolean;
            cause?: Error;
        } = {}
    ) {
        super(message, { cause: options.cause });
        this.name = 'OverseekError';
        this.statusCode = options.statusCode ?? 500;
        this.code = options.code ?? 'INTERNAL_ERROR';
        this.context = options.context;
        this.isRecoverable = options.isRecoverable ?? false;
    }

    /** Convert to JSON for API responses */
    toJSON() {
        return {
            error: this.message,
            code: this.code,
            ...(process.env.NODE_ENV !== 'production' && this.context ? { context: this.context } : {}),
        };
    }
}

// ============================================================================
// AI Service Errors
// ============================================================================

export class AIServiceError extends OverseekError {
    constructor(
        message: string,
        options: {
            code?: string;
            context?: Record<string, unknown>;
            isRecoverable?: boolean;
            cause?: Error;
        } = {}
    ) {
        super(message, {
            statusCode: 503,
            code: options.code ?? 'AI_SERVICE_ERROR',
            ...options,
        });
        this.name = 'AIServiceError';
    }
}

export class AIRateLimitError extends AIServiceError {
    constructor(retryAfterSeconds?: number) {
        super('AI service is temporarily unavailable. Please try again in a moment.', {
            code: 'AI_RATE_LIMITED',
            isRecoverable: true,
            context: retryAfterSeconds ? { retryAfterSeconds } : undefined,
        });
        this.name = 'AIRateLimitError';
    }
}

export class AIConfigurationError extends AIServiceError {
    constructor(reason: string) {
        super(`AI service is not configured: ${reason}`, {
            code: 'AI_NOT_CONFIGURED',
            isRecoverable: false,
        });
        this.name = 'AIConfigurationError';
    }
}

// ============================================================================
// External API Errors
// ============================================================================

export class ExternalAPIError extends OverseekError {
    constructor(
        service: string,
        message: string,
        options: {
            statusCode?: number;
            context?: Record<string, unknown>;
            cause?: Error;
        } = {}
    ) {
        super(`${service}: ${message}`, {
            statusCode: options.statusCode ?? 502,
            code: 'EXTERNAL_API_ERROR',
            isRecoverable: true,
            ...options,
        });
        this.name = 'ExternalAPIError';
    }
}

// ============================================================================
// Validation Errors
// ============================================================================

export class ValidationError extends OverseekError {
    constructor(
        message: string,
        options: {
            field?: string;
            context?: Record<string, unknown>;
        } = {}
    ) {
        super(message, {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            isRecoverable: true,
            context: options.field ? { field: options.field, ...options.context } : options.context,
        });
        this.name = 'ValidationError';
    }
}

// ============================================================================
// Resource Errors
// ============================================================================

export class NotFoundError extends OverseekError {
    constructor(resource: string, id?: string | number) {
        super(id ? `${resource} with ID '${id}' not found` : `${resource} not found`, {
            statusCode: 404,
            code: 'NOT_FOUND',
            isRecoverable: false,
            context: { resource, id },
        });
        this.name = 'NotFoundError';
    }
}

// ============================================================================
// Authentication & Authorization Errors
// ============================================================================

export class AuthenticationError extends OverseekError {
    constructor(message = 'Authentication required') {
        super(message, {
            statusCode: 401,
            code: 'AUTHENTICATION_ERROR',
            isRecoverable: true,
        });
        this.name = 'AuthenticationError';
    }
}

export class AuthorizationError extends OverseekError {
    constructor(message = 'Not authorized to access this resource') {
        super(message, {
            statusCode: 403,
            code: 'AUTHORIZATION_ERROR',
            isRecoverable: false,
        });
        this.name = 'AuthorizationError';
    }
}

// ============================================================================
// Rate Limiting & Conflicts
// ============================================================================

export class RateLimitError extends OverseekError {
    constructor(retryAfterSeconds?: number) {
        super('Too many requests. Please slow down and try again.', {
            statusCode: 429,
            code: 'RATE_LIMIT_ERROR',
            isRecoverable: true,
            context: retryAfterSeconds ? { retryAfterSeconds } : undefined,
        });
        this.name = 'RateLimitError';
    }
}

export class ConflictError extends OverseekError {
    constructor(resource: string, reason?: string) {
        super(reason ? `${resource}: ${reason}` : `${resource} already exists or conflicts with existing data`, {
            statusCode: 409,
            code: 'CONFLICT_ERROR',
            isRecoverable: false,
            context: { resource },
        });
        this.name = 'ConflictError';
    }
}

export class ServiceUnavailableError extends OverseekError {
    constructor(service: string, reason?: string) {
        super(reason || `${service} is temporarily unavailable. Please try again later.`, {
            statusCode: 503,
            code: 'SERVICE_UNAVAILABLE',
            isRecoverable: true,
            context: { service },
        });
        this.name = 'ServiceUnavailableError';
    }
}

// ============================================================================
// Type Guards
// ============================================================================

export function isOverseekError(error: unknown): error is OverseekError {
    return error instanceof OverseekError;
}

// ============================================================================
// User-Friendly Message Mapping
// ============================================================================

/**
 * Error code to user-friendly message mapping.
 * These messages are safe to display directly to end users.
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

    // Generic
    'INTERNAL_ERROR': 'Something went wrong. Please try again or contact support.',
};

/**
 * Gets a user-friendly message for an error.
 * Falls back to a generic message for unknown errors.
 */
export function getFriendlyMessage(error: unknown): string {
    if (isOverseekError(error)) {
        return FRIENDLY_MESSAGES[error.code] || error.message;
    }

    if (error instanceof Error) {
        // Check for common error patterns
        const msg = error.message.toLowerCase();

        if (msg.includes('network') || msg.includes('fetch')) {
            return 'Network error. Please check your connection and try again.';
        }
        if (msg.includes('timeout')) {
            return 'The request took too long. Please try again.';
        }
    }

    return FRIENDLY_MESSAGES['INTERNAL_ERROR'];
}

/**
 * Converts any error to a consistent API response format.
 */
export function toErrorResponse(error: unknown): {
    error: string;
    code: string;
    isRecoverable: boolean;
    context?: Record<string, unknown>;
} {
    if (isOverseekError(error)) {
        return {
            error: getFriendlyMessage(error),
            code: error.code,
            isRecoverable: error.isRecoverable,
            ...(process.env.NODE_ENV !== 'production' && error.context ? { context: error.context } : {}),
        };
    }

    return {
        error: getFriendlyMessage(error),
        code: 'INTERNAL_ERROR',
        isRecoverable: false,
    };
}

/**
 * Standardized route error handler for Fastify.
 * Logs the error and sends a consistent response.
 * 
 * @example
 * } catch (error) {
 *     return handleRouteError(error, reply, 'Failed to fetch products');
 * }
 */
export function handleRouteError(
    error: unknown,
    reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } },
    context?: string
): unknown {
    // Extract status code
    const statusCode = isOverseekError(error) ? error.statusCode : 500;

    // Build response
    const response = toErrorResponse(error);

    // Add context if provided and not in production
    if (context && process.env.NODE_ENV !== 'production') {
        response.context = { ...response.context, operation: context };
    }

    return reply.code(statusCode).send(response);
}

