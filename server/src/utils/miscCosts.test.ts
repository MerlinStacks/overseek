import { describe, expect, it } from 'vitest';
import { sumMiscCosts } from './miscCosts';
describe('miscellaneous cost totals', () => {
    it('preserves finite numbers, decimal legacy strings and negative adjustments', () => {
        expect(sumMiscCosts([{ amount: 10 }, { amount: ' 2.50 ' }, { amount: -1.25 }])).toBe(11.25);
    });
    it('ignores malformed values rather than coercing booleans, arrays or infinities into money', () => {
        expect(sumMiscCosts([null, [], { amount: true }, { amount: [] }, { amount: '' }, { amount: '0x10' }, { amount: Infinity }, { amount: 'Infinity' }, { amount: NaN }, { amount: 5 }])).toBe(5);
        expect(sumMiscCosts(null)).toBe(0);
    });
    it('rejects numeric overflow rather than returning an infinite total', () => {
        expect(() => sumMiscCosts([{ amount: Number.MAX_VALUE }, { amount: Number.MAX_VALUE }])).toThrow(RangeError);
    });
});
