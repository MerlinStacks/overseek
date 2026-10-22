import { describe, expect, it } from 'vitest';
import { applyEmailPreviewScenario, EMAIL_PREVIEW_SCENARIOS } from './EmailPreviewScenarios';
describe('synthetic delivery scenarios', () => {
    it('never mutates the original context', () => {
        const context = { customer: { firstName: 'Alex' }, order: { total: '40.00', lineItems: [] }, cart: { items: [], total: '40.00' } };
        const original = structuredClone(context);
        for (const scenario of EMAIL_PREVIEW_SCENARIOS) applyEmailPreviewScenario(context, scenario);
        expect(context).toEqual(original);
        expect(applyEmailPreviewScenario(context, 'many-items').cart.items).toHaveLength(25);
        expect(applyEmailPreviewScenario(context, 'empty-cart').cart).toMatchObject({ items: [], total: '0.00' });
        expect(applyEmailPreviewScenario(context, 'no-estimate').order.deliveryEstimateSnapshot).toBeNull();
        expect(applyEmailPreviewScenario(context, 'discounts').order).toMatchObject({ total: '75.00', discountTotal: '25.00' });
    });
});
