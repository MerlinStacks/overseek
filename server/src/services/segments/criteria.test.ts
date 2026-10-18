import { describe, expect, it } from 'vitest';
import { validateCriteria } from './criteria';

describe('Advertising segment criteria', () => {
    it.each(['purchasedWithinDays', 'notPurchasedWithinDays', 'abandonedCartWithinDays'])('supports %s', field => {
        expect(validateCriteria({ type: 'AND', rules: [{ field, operator: 'within', value: '30' }] })).toBeNull();
    });
    it.each(['0', '-1', '1.5', '3651', '', 'NaN'])('rejects invalid rolling days %s', value => {
        expect(validateCriteria({ type: 'AND', rules: [{ field: 'purchasedWithinDays', operator: 'within', value }] })).not.toBeNull();
    });
    it('rejects unknown fields and operators rather than silently matching everyone', () => {
        expect(validateCriteria({ type: 'AND', rules: [{ field: 'unknown', operator: 'eq', value: 1 }] })).not.toBeNull();
        expect(validateCriteria({ type: 'AND', rules: [{ field: 'totalSpent', operator: 'contains', value: 1 }] })).not.toBeNull();
    });
    it('keeps existing AND/OR and all-customer segments compatible', () => {
        expect(validateCriteria({ type: 'AND', rules: [] })).toBeNull();
        expect(validateCriteria({ type: 'OR', rules: [{ field: 'ordersCount', operator: 'gte', value: 2 }] })).toBeNull();
    });
});
