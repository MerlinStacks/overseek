import { describe, expect, it } from 'vitest';
import { purchaseOrderDate } from './sourceDate';

describe('PO source calendar labels', () => {
    it('preserves the leading date across offsets, leap days and backward edits', () => {
        for (const input of ['2028-02-29', '2028-02-29T00:00:00+14:00', '2028-02-29T23:00:00-12:00']) {
            expect(purchaseOrderDate(input)?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
        }
        expect(purchaseOrderDate('2026-09-01')?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
        expect(purchaseOrderDate('')).toBeNull();
        for (const value of ['2026-02-29', 'tomorrow', '2026-13-01', '0000-01-01', '2026-09-22Tgarbage']) expect(() => purchaseOrderDate(value)).toThrow('expected date');
    });
});
