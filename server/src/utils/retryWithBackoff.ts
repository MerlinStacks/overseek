import { Logger } from './logger';


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

/** retryable by default: 429, 5xx, network errors, timeouts */
export function isRetryableError(error: any): boolean {

    const status = error?.response?.status || error?.status;
    if (status) {
        const retryableStatuses = [429, 500, 502, 503, 504];
        if (retryableStatuses.includes(status)) {
            return true;
        }
    }


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


    if (error?.message?.includes('Network Error')) {
        return true;
    }


    if (error?.message?.includes('timeout') || error?.message?.includes('Timeout')) {
        return true;
    }

    return false;
}

/** Detects 401/403 responses indicating revoked or invalid API credentials */
export function isCredentialError(error: any): boolean {
    const status = error?.response?.status || error?.status;
    return status === 401 || status === 403;
}

/** backoff with jitter: min(base * 2^attempt, max) ± 10% */
export function calculateBackoffDelay(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number
): number {

    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

    // jitter to avoid thundering herd
    const jitterFactor = 0.9 + Math.random() * 0.2;
    return Math.round(cappedDelay * jitterFactor);
}

/**
 * retry an async fn with exponential backoff on transient failures.
 *
 * @example
 * const result = await retryWithBackoff(() => fetchFromApi());
 *
 * @example
 * const result = await retryWithBackoff(
 *   () => wooApi.getOrders(),
 *   { maxRetries: 5, context: 'WooCommerce:getOrders' }
 * );
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
