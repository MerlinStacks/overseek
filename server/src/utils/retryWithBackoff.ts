import { Logger } from './logger';

/**
 * Configuration options for retry behavior.
 */
export interface RetryOptions {
    /** Maximum number of retry attempts. Default: 3 */
    maxRetries?: number;
    /** Base delay in milliseconds before first retry. Default: 1000 */
    baseDelayMs?: number;
    /** Maximum delay cap in milliseconds. Default: 30000 */
    maxDelayMs?: number;
    /** Custom function to determine if an error should trigger a retry */
    retryOn?: (error: any) => boolean;
    /** Context label for logging. Default: 'operation' */
    context?: string;
}

/**
 * Default conditions that trigger a retry:
 * - HTTP 429 (Too Many Requests)
 * - HTTP 500, 502, 503, 504 (Server errors)
 * - Network errors (ECONNRESET, ETIMEDOUT, ECONNREFUSED, etc.)
 */
export function isRetryableError(error: any): boolean {
    // HTTP status code checks
    const status = error?.response?.status || error?.status;
    if (status) {
        const retryableStatuses = [429, 500, 502, 503, 504];
        if (retryableStatuses.includes(status)) {
            return true;
        }
    }

    // Network error code checks
    const code = error?.code || error?.cause?.code;
    if (code) {
        const retryableCodes = [
            'ECONNRESET',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'ENETUNREACH',
            'EAI_AGAIN',
            'EPIPE',
            'EHOSTUNREACH'
        ];
        if (retryableCodes.includes(code)) {
            return true;
        }
    }

    // Axios-specific network error
    if (error?.message?.includes('Network Error')) {
        return true;
    }

    // WooCommerce REST API timeout
    if (error?.message?.includes('timeout') || error?.message?.includes('Timeout')) {
        return true;
    }

    return false;
}

/**
 * Calculate delay with exponential backoff and jitter.
 * Formula: min(baseDelay * 2^attempt, maxDelay) ± 10% jitter
 * 
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap
 */
export function calculateBackoffDelay(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number
): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s...
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

    // Add jitter: ±10% randomization to prevent thundering herd
    const jitterFactor = 0.9 + Math.random() * 0.2; // 0.9 to 1.1
    return Math.round(cappedDelay * jitterFactor);
}

/**
 * Execute an async function with automatic retry on transient failures.
 * Uses exponential backoff with jitter to prevent thundering herd.
 * 
 * @example
 * // Basic usage
 * const result = await retryWithBackoff(() => fetchFromApi());
 * 
 * @example
 * // With custom options
 * const result = await retryWithBackoff(
 *   () => wooApi.getOrders(),
 *   { maxRetries: 5, context: 'WooCommerce:getOrders' }
 * );
 * 
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Result of the function
 * @throws Last error if all retries exhausted
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        maxDelayMs = 30000,
        retryOn = isRetryableError,
        context = 'operation'
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Check if we should retry
            if (attempt >= maxRetries || !retryOn(error)) {
                break;
            }

            const delay = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);

            Logger.warn(`[RetryWithBackoff] ${context} failed, attempt ${attempt + 1}/${maxRetries + 1}`, {
                error: error.message,
                code: error.code || error.response?.status,
                nextRetryMs: delay
            });

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    Logger.error(`[RetryWithBackoff] ${context} failed after ${maxRetries + 1} attempts`, {
        error: lastError?.message
    });

    throw lastError;
}
