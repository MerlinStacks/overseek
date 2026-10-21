import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce, isEqual } from './debounce';
afterEach(() => vi.useRealTimers());
describe('debounced callback lifecycle', () => {
    it('invokes only the last arguments with the original receiver', () => {
        vi.useFakeTimers(); const fn = vi.fn(function (this: { value: number }, value: number) { return this.value + value; }); const delayed = debounce(fn, 10); const receiver = { value: 2, delayed };
        expect(receiver.delayed(1)).toBeUndefined(); receiver.delayed(3); vi.advanceTimersByTime(10); expect(fn).toHaveBeenCalledOnce(); expect(fn).toHaveBeenCalledWith(3); expect(fn.mock.contexts[0]).toBe(receiver);
    });
    it('retains cancellation tracking when a callback schedules itself', () => {
        vi.useFakeTimers(); let calls = 0; const delayed = debounce(() => { calls++; delayed(); }, 10); delayed(); vi.advanceTimersByTime(10); delayed.cancel(); vi.advanceTimersByTime(100); expect(calls).toBe(1);
    });
    it('compares plain objects structurally without losing undefined properties or coercing invalid numbers', () => {
        expect(isEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true); expect(isEqual({ a: undefined }, {})).toBe(false); expect(isEqual({ a: NaN }, { a: null })).toBe(false); expect(isEqual(new Date(0), new Date(0))).toBe(false);
    });
});
