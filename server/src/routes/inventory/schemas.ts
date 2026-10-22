import { z } from 'zod';
const numeric = z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).pipe(z.number().finite());
const wooId = numeric.pipe(z.number().int().min(0).max(2147483647));
const decimal4 = numeric.refine(value => Math.abs(value * 10000 - Math.round(value * 10000)) < 0.00001, 'At most four decimal places are supported');

export const bomVariationQuerySchema = z.object({
    variationId: wooId.default(0)
});

export const bomItemInputSchema = z.object({
    supplierItemId: z.string().uuid().nullable().optional(),
    childProductId: z.string().uuid().nullable().optional(),
    childVariationId: wooId.refine(value => value > 0).nullable().optional(),
    internalProductId: z.string().uuid().nullable().optional(),
    quantity: decimal4.refine(value => value > 0 && value <= 999999.9999, 'Quantity exceeds supported precision/range'),
    wasteFactor: decimal4.refine(value => value >= 0 && value <= 1, 'Waste must be a ratio from 0 to 1 (100%)').default(0)
}).refine(
    (item) => [item.supplierItemId, item.childProductId, item.internalProductId].filter(Boolean).length === 1,
    { message: 'Each BOM item must reference exactly one supplier item, WooCommerce product, or internal product' }
).refine(
    (item) => !item.childVariationId || Boolean(item.childProductId),
    { message: 'childVariationId requires childProductId' }
);

export const bomSaveBodySchema = z.object({
    variationId: wooId.default(0),
    items: z.array(bomItemInputSchema).max(500)
});
