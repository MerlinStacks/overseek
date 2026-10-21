import { describe, expect, it } from 'vitest';
import { goldSummaryMargin } from './goldSummaryMargin';
describe('truthful sampled gold margins', () => {
    it('keeps configured zero cost valid and accounts for miscellaneous costs', () => {
        expect(goldSummaryMargin(100, 2, '18ct', [{ amount: 10 }], { goldPrice18ct: 20 })).toBe(50);
        expect(goldSummaryMargin(100, 2, '18ct', [], { goldPrice18ct: 0 })).toBe(100);
    });
    it.each([
        [null, 2, '18ct', [], { goldPrice18ct: 20 }], [0, 2, '18ct', [], { goldPrice18ct: 20 }],
        [100, null, '18ct', [], { goldPrice18ct: 20 }], [100, 2, '18ct', [], { goldPrice18ct: null }],
        [100, 2, 'unknown', [], {}], [100, 2, '18ct', [{ amount: 'bad' }], { goldPrice18ct: 20 }],
    ])('leaves missing or invalid inputs unavailable %#', (price, weight, type, misc, account) => {
        expect(goldSummaryMargin(price, weight, type as string, misc, account as Record<string, unknown>)).toBeNull();
    });
});
