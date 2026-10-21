import { describe, expect, it } from 'vitest';
import { extractBillingInfo, extractCustomerId, extractLineItems, calculateLineItemRevenue, getFirstProductCategory } from './orderDataExtractor';
describe('validated order extraction', () => {
    it('handles malformed billing and normalizes valid strings/identifiers', () => {
        expect(extractBillingInfo({ rawData: { billing: { email: 42, city: [] } } }).email).toBeNull();
        expect(extractBillingInfo({ rawData: { billing: { email: ' A@B.COM ' } } }).email).toBe('a@b.com');
        expect(extractCustomerId({ rawData: { customer_id: '42' } })).toBe(42);
        for (const id of [true, {}, -1, '2x', 0]) expect(extractCustomerId({ rawData: { customer_id: id } })).toBeNull();
    });
    it('preserves real zero money and does not infer a category from a name', () => {
        const order = { rawData: { line_items: [{ product_id: 1, quantity: 1, total: '0.00', name: 'Widget', meta_data: {} }] } };
        expect(calculateLineItemRevenue(order)).toBe(0); expect(getFirstProductCategory(order)).toBeNull();
    });
    it.each([{}, { line_items: {} }, { line_items: [{ product_id: 1, quantity: 1, total: '2x' }] }, { line_items: [{ product_id: true, quantity: 1, total: 0 }] }])('exposes invalid or missing line data %j', rawData => {
        expect(() => extractLineItems({ rawData })).toThrow();
    });
});
