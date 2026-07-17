import { describe, expect, it, vi } from 'vitest';

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});

import { bomSaveBodySchema } from './schemas';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const INTERNAL_ID = '22222222-2222-4222-8222-222222222222';
const SUPPLIER_ID = '33333333-3333-4333-8333-333333333333';

describe('bomSaveBodySchema', () => {
    it('accepts unique stock-tracked components', () => {
        const result = bomSaveBodySchema.safeParse({
            variationId: 0,
            items: [
                { childProductId: PRODUCT_ID, quantity: 1, wasteFactor: 0 },
                { internalProductId: INTERNAL_ID, quantity: 2, wasteFactor: 0.1 }
            ]
        });

        expect(result.success).toBe(true);
    });

    it('accepts duplicate legacy product components', () => {
        const result = bomSaveBodySchema.safeParse({
            variationId: 0,
            items: [
                { childProductId: PRODUCT_ID, quantity: 1 },
                { childProductId: PRODUCT_ID, quantity: 2 }
            ]
        });

        expect(result.success).toBe(true);
    });

    it('allows separate variations of the same product', () => {
        const result = bomSaveBodySchema.safeParse({
            variationId: 0,
            items: [
                { childProductId: PRODUCT_ID, childVariationId: 10, quantity: 1 },
                { childProductId: PRODUCT_ID, childVariationId: 11, quantity: 1 }
            ]
        });

        expect(result.success).toBe(true);
    });

    it('accepts supplier catalogue items as cost-only components', () => {
        const result = bomSaveBodySchema.safeParse({
            variationId: 0,
            items: [{ supplierItemId: SUPPLIER_ID, quantity: 1 }]
        });

        expect(result.success).toBe(true);
    });
});
