import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    retryWithBackoff,
    isRetryableError,
    calculateBackoffDelay
} from '../retryWithBackoff';

// Mock the logger to avoid actual logging during tests
vi.mock('../logger', () => ({
    Logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn()
    }
}));

describe('isRetryableError', () => {
    it('returns true for HTTP 429 (rate limit)', () => {
        expect(isRetryableError({ response: { status: 429 } })).toBe(true);
    });

    it('returns true for HTTP 500-504 (server errors)', () => {
        expect(isRetryableError({ response: { status: 500 } })).toBe(true);
        expect(isRetryableError({ response: { status: 502 } })).toBe(true);
        expect(isRetryableError({ response: { status: 503 } })).toBe(true);
        expect(isRetryableError({ response: { status: 504 } })).toBe(true);
    });

    it('returns false for HTTP 400, 401, 404 (client errors)', () => {
        expect(isRetryableError({ response: { status: 400 } })).toBe(false);
        expect(isRetryableError({ response: { status: 401 } })).toBe(false);
        expect(isRetryableError({ response: { status: 404 } })).toBe(false);
    });

    it('returns true for network error codes', () => {
        expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
        expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
        expect(isRetryableError({ code: 'ECONNREFUSED' })).toBe(true);
    });

    it('returns true for timeout messages', () => {
        expect(isRetryableError({ message: 'Request timeout exceeded' })).toBe(true);
        expect(isRetryableError({ message: 'Timeout of 5000ms exceeded' })).toBe(true);
    });

    it('returns false for non-retryable errors', () => {
        expect(isRetryableError({ message: 'Invalid JSON' })).toBe(false);
        expect(isRetryableError(new Error('Something went wrong'))).toBe(false);
    });
});

describe('calculateBackoffDelay', () => {
    it('calculates exponential delays', () => {
        // With jitter disabled for testing, we'd expect:
        // attempt 0: 1000ms, attempt 1: 2000ms, attempt 2: 4000ms
        const delay0 = calculateBackoffDelay(0, 1000, 30000);
        const delay1 = calculateBackoffDelay(1, 1000, 30000);
        const delay2 = calculateBackoffDelay(2, 1000, 30000);

        // Allow for ±10% jitter
        expect(delay0).toBeGreaterThanOrEqual(900);
        expect(delay0).toBeLessThanOrEqual(1100);

        expect(delay1).toBeGreaterThanOrEqual(1800);
        expect(delay1).toBeLessThanOrEqual(2200);

        expect(delay2).toBeGreaterThanOrEqual(3600);
        expect(delay2).toBeLessThanOrEqual(4400);
    });

    it('caps delay at maxDelayMs', () => {
        const delay = calculateBackoffDelay(10, 1000, 5000);
        // 2^10 * 1000 = 1024000, but capped at 5000 ±10%
        expect(delay).toBeLessThanOrEqual(5500);
    });
});

describe('retryWithBackoff', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns result on first success', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        const result = await retryWithBackoff(fn);

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on retryable error and succeeds', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce({ response: { status: 429 } })
            .mockResolvedValue('success');

        const promise = retryWithBackoff(fn, { baseDelayMs: 100 });

        // Fast-forward through the delay
        await vi.advanceTimersByTimeAsync(200);

        const result = await promise;

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries exhausted', async () => {
        const error = { response: { status: 500 }, message: 'Server Error' };
        const fn = vi.fn().mockRejectedValue(error);

        const promise = retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 100 });

        // Fast-forward through all delays
        await vi.advanceTimersByTimeAsync(1000);

        await expect(promise).rejects.toEqual(error);
        expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('does not retry on non-retryable error', async () => {
        const error = { response: { status: 404 }, message: 'Not Found' };
        const fn = vi.fn().mockRejectedValue(error);

        await expect(retryWithBackoff(fn)).rejects.toEqual(error);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('respects custom retryOn function', async () => {
        const error = new Error('Custom error');
        const fn = vi.fn().mockRejectedValue(error);
        const customRetryOn = vi.fn().mockReturnValue(false);

        await expect(
            retryWithBackoff(fn, { retryOn: customRetryOn })
        ).rejects.toThrow('Custom error');

        expect(customRetryOn).toHaveBeenCalledWith(error);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
