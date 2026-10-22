export const EMAIL_PREVIEW_SCENARIOS = ['standard', 'long-name', 'no-images', 'empty-cart', 'many-items', 'discounts', 'no-estimate'] as const;
export type EmailPreviewScenario = typeof EMAIL_PREVIEW_SCENARIOS[number];
/** Synthetic stress data only. Never persisted into customer/order records. */
export function applyEmailPreviewScenario(context: any, scenario: EmailPreviewScenario) {
    if (scenario === 'standard') return context;
    const copy = structuredClone(context);
    if (scenario === 'long-name') copy.customer = { ...copy.customer, firstName: 'Alexandria-Samantha', lastName: 'Montgomery-Wellington and family' };
    if (scenario === 'empty-cart') copy.cart = { ...copy.cart, items: [], total: '0.00' };
    if (scenario === 'no-estimate') copy.order = { ...copy.order, deliveryEstimateSnapshot: null };
    if (scenario === 'many-items') {
        const items = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, name: `Product ${index + 1} with a deliberately long description and custom options`, quantity: 2, price: '20.00', total: '40.00', meta_data: [{ key: 'Engraving', value: 'A long custom message to exercise wrapping' }] }));
        copy.order = { ...copy.order, lineItems: items, line_items: items, total: '1000.00' }; copy.cart = { ...copy.cart, items, total: '1000.00' };
    }
    if (scenario === 'discounts') copy.order = { ...copy.order, subtotal: '100.00', discountTotal: '25.00', shippingTotal: '0.00', taxTotal: '0.00', total: '75.00' };
    if (scenario === 'no-images') {
        copy.product = { ...copy.product, image: '', mainImage: '' };
        copy.order = { ...copy.order, lineItems: (copy.order?.lineItems || []).map((item: any) => ({ ...item, image: null, images: [] })) };
        copy.cart = { ...copy.cart, items: (copy.cart?.items || []).map((item: any) => ({ ...item, image: null, images: [] })) };
    }
    return copy;
}
