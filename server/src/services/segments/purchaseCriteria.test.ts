import { describe, expect, it } from 'vitest';
import { validateCriteria } from './criteria';

describe('Purchase segment validation', () => {
    const criteria = (updates = {}) => ({ type: 'AND', rules: [{ field: 'purchasedProduct', operator: 'purchased', value: '42', ...updates }] });
    it.each(['purchasedProduct', 'purchasedCategory'])('accepts %s rules and optional day windows', field => {
        expect(validateCriteria(criteria({ field }))).toBeNull();
        expect(validateCriteria(criteria({ field, withinDays: '30', operator: 'notPurchased' }))).toBeNull();
    });
    it.each(['', 'abc', '0', '-1', '1.5', '9007199254740992'])('rejects invalid selection %s', value => {
        expect(validateCriteria(criteria({ value }))).not.toBeNull();
    });
    it.each(['', '0', '1.5', '3651', 'abc'])('rejects invalid purchase window %s', withinDays => {
        expect(validateCriteria(criteria({ withinDays }))).not.toBeNull();
    });
    it('rejects invalid operators and purchase windows on unrelated fields', () => {
        expect(validateCriteria(criteria({ operator: 'contains' }))).not.toBeNull();
        expect(validateCriteria(criteria({ field: 'totalSpent', operator: 'gt', withinDays: '30' }))).not.toBeNull();
    });
});
