import { describe, expect, it } from 'vitest';
import { inferWholesaleTierRanges, requiresFinalTierRemovalConfirmation, validateWholesaleTiers } from './tierValidation';

describe('wholesale tier helpers', () => {
    it('infers contiguous display ranges from minimum quantities', () => {
        expect(inferWholesaleTierRanges([
            { minimumQuantity: 10, unitPrice: '9', isPoa: false },
            { minimumQuantity: 25, unitPrice: '8', isPoa: false },
            { minimumQuantity: 100, unitPrice: null, isPoa: true },
        ])).toEqual(['10-24', '25-99', '100+']);
    });

    it('accepts ascending MOQ, descending prices, then POA', () => {
        expect(validateWholesaleTiers([
            { minimumQuantity: 10, unitPrice: '12.50', isPoa: false },
            { minimumQuantity: 20, unitPrice: '10', isPoa: false },
            { minimumQuantity: 50, unitPrice: null, isPoa: true },
        ])).toEqual([]);
    });

    it('rejects duplicate MOQ, price increases, and numeric rows after POA', () => {
        const errors = validateWholesaleTiers([
            { minimumQuantity: 10, unitPrice: '10', isPoa: false },
            { minimumQuantity: 10, unitPrice: null, isPoa: true },
            { minimumQuantity: 30, unitPrice: '12', isPoa: false },
        ]);
        expect(errors).toContain('Minimum quantities must be unique and ascending.');
        expect(errors).toContain('POA tiers must follow all numeric tiers.');
        expect(errors).toContain('Numeric prices must be non-increasing.');
    });

    it('validates optional quantity-break lead times', () => {
        expect(validateWholesaleTiers([{ minimumQuantity: 10, unitPrice: '5', isPoa: false, leadTimeDays: 1.5 }]))
            .toContain('Tier 1 lead time must be a whole number from 0 to 3650 days.');
        expect(validateWholesaleTiers([{ minimumQuantity: 10, unitPrice: '5', isPoa: false, leadTimeDays: 7 }])).toEqual([]);
    });

    it('requires confirmation only before removing the final tier', () => {
        const tier = { minimumQuantity: 10, unitPrice: '10', isPoa: false };
        expect(requiresFinalTierRemovalConfirmation([tier], 0)).toBe(true);
        expect(requiresFinalTierRemovalConfirmation([tier, { ...tier, minimumQuantity: 20 }], 0)).toBe(false);
    });
});
