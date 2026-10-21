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
    signal?: AbortSignal;
    /** Set false for writes whose outcome cannot be safely repeated. */
    idempotent?: boolean;
}

function getHeaderValue(headers: any, key: string): string | undefined {
    if (!headers) return undefined;
    if (typeof headers.get === 'function') {
        const value = headers.get(key);
        return typeof value === 'string' ? value : undefined;
    }

    const matched = Object.keys(headers).find(header => header.toLowerCase() === key.toLowerCase());
    const direct = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()] ?? (matched ? headers[matched] : undefined);
    if (Array.isArray(direct)) return direct[0];
    if (typeof direct === 'string') return direct;
    return undefined;
}

/** retryable by default: 429, 5xx, network errors, timeouts */
export function isRetryableError(error: any): boolean {
    if (error?.name === 'AbortError') return false;

    const status = Number(error?.response?.status ?? error?.status);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
        const retryableStatuses = [429, 500, 502, 503, 504];
        return retryableStatuses.includes(status);
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


    if (typeof error?.message === 'string' && error.message.includes('Network Error')) {
        return true;
    }


    if (typeof error?.message === 'string' && /timeout/i.test(error.message)) {
        return true;
    }

    return false;
}

/** Detects 401/403 responses indicating revoked or invalid API credentials */
export function isCredentialError(error: any): boolean {
    const status = Number(error?.response?.status ?? error?.status);
    return status === 401 || status === 403;
}

/** Detects 503 responses with Retry-After header indicating scheduled maintenance */
export function isMaintenanceMode(error: any): boolean {
    const status = Number(error?.response?.status ?? error?.status);
    const retryAfter = getHeaderValue(error?.response?.headers, 'retry-after');
    return status === 503 && !!retryAfter;
}

/** Extract Retry-After seconds from a maintenance-mode response when present */
export function getRetryAfterSeconds(error: any): number | null {
    const retryAfter = getHeaderValue(error?.response?.headers, 'retry-after');
    if (!retryAfter) return null;

    const parsed = /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),/.test(retryAfter) ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000) : NaN;
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** backoff with jitter: min(base * 2^attempt, max) ± 10% */
export function calculateBackoffDelay(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number
): number {
    if (!Number.isInteger(attempt) || attempt < 0 || attempt > 1000 || !Number.isFinite(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 2147483647 || !Number.isFinite(maxDelayMs) || maxDelayMs < 0 || maxDelayMs > 2147483647) throw new Error('Invalid retry delay options');

    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

    // jitter to avoid thundering herd
    const jitterFactor = 0.9 + Math.random() * 0.2;
    return Math.min(maxDelayMs, Math.round(cappedDelay * jitterFactor));
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
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 20 || typeof retryOn !== 'function') throw new Error('Invalid retry options');
    calculateBackoffDelay(0, baseDelayMs, maxDelayMs);
    const message = (value: unknown) => value instanceof Error ? value.message : typeof value === 'string' ? value : 'Operation failed';

    let lastError: unknown;
    let attempts = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            options.signal?.throwIfAborted();
            attempts++;
            return await fn();
        } catch (error: any) {
            lastError = error;
            if (options.signal?.aborted) throw options.signal.reason;

            // Maintenance mode: don't waste retries, fail immediately with descriptive error
            if (isMaintenanceMode(error)) {
                const retryAfter = getRetryAfterSeconds(error) ?? 'unknown';
                Logger.error(`[RetryWithBackoff] ${context} - site is in maintenance mode (Retry-After: ${retryAfter}s). Skipping retries.`, {
                    error: message(error)
                });
                throw error;
            }


            if (attempt >= maxRetries || options.idempotent === false || !retryOn(error)) {
                break;
            }

            const delay = Math.max(calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs), (getRetryAfterSeconds(error) ?? 0) * 1000);
            // Do not retry earlier than the provider's window or allocate unbounded timers.
            if (delay > maxDelayMs) break;

            Logger.warn(`[RetryWithBackoff] ${context} failed, attempt ${attempt + 1}/${maxRetries + 1}`, {
                error: message(error),
                code: error?.code || error?.response?.status,
                nextRetryMs: delay
            });

            await new Promise<void>((resolve, reject) => {
                const onAbort = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); reject(options.signal.reason); };
                const timer = setTimeout(() => { options.signal?.removeEventListener('abort', onAbort); resolve(); }, delay);
                options.signal?.addEventListener('abort', onAbort, { once: true });
                if (options.signal?.aborted) onAbort();
            });
        }
    }

    Logger.error(`[RetryWithBackoff] ${context} failed after ${attempts} attempts`, {
        error: message(lastError)
    });

    throw lastError;
}
