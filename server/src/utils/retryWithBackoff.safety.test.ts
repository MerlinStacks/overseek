import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateBackoffDelay, getRetryAfterSeconds, retryWithBackoff } from './retryWithBackoff';
vi.mock('./logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
describe('bounded cancellable retries', () => {
    it.each([{ maxRetries: -1 }, { maxRetries: Infinity }, { baseDelayMs: NaN }, { maxDelayMs: 3e9 }])('rejects invalid options before execution %j', async options => {
        const fn = vi.fn(); await expect(retryWithBackoff(fn, options)).rejects.toThrow('Invalid'); expect(fn).not.toHaveBeenCalled();
    });
    it('keeps jitter within the actual configured cap', () => { vi.spyOn(Math, 'random').mockReturnValue(1); expect(calculateBackoffDelay(10, 1000, 5000)).toBe(5000); });
    it('parses Headers/date values and rejects partial numeric Retry-After', () => {
        expect(getRetryAfterSeconds({ response: { headers: new Headers({ 'Retry-After': '12' }) } })).toBe(12);
        expect(getRetryAfterSeconds({ response: { headers: { 'retry-after': '12junk' } } })).toBeNull();
        expect(getRetryAfterSeconds({ response: { headers: new Headers({ 'Retry-After': new Date(Date.now() + 60000).toUTCString() }) } })).toBeGreaterThan(58);
    });
    it('preserves primitive failures and does not repeat unsafe writes', async () => {
        await expect(retryWithBackoff(async () => { throw null; })).rejects.toBeNull();
        const fn = vi.fn().mockRejectedValue({ status: 500 }); await expect(retryWithBackoff(fn, { idempotent: false })).rejects.toMatchObject({ status: 500 }); expect(fn).toHaveBeenCalledOnce();
    });
    it('cancels a pending delay without another operation attempt', async () => {
        const controller = new AbortController(); const fn = vi.fn().mockRejectedValue({ status: 500 });
        const pending = retryWithBackoff(fn, { signal: controller.signal, baseDelayMs: 10000 });
        await Promise.resolve(); controller.abort(new Error('Cancelled')); await expect(pending).rejects.toThrow('Cancelled'); expect(fn).toHaveBeenCalledOnce();
    });
});
