import { z } from 'zod';

export const bomVariationQuerySchema = z.object({
    variationId: z.coerce.number().int().nonnegative().default(0)
});

export const bomItemInputSchema = z.object({
    supplierItemId: z.string().uuid().nullable().optional(),
    childProductId: z.string().uuid().nullable().optional(),
    childVariationId: z.coerce.number().int().positive().nullable().optional(),
    internalProductId: z.string().uuid().nullable().optional(),
    quantity: z.coerce.number().positive(),
    wasteFactor: z.coerce.number().min(0).max(10).default(0)
}).refine(
    (item) => Boolean(item.supplierItemId || item.childProductId || item.internalProductId),
    { message: 'Each BOM item must reference a supplier item, WooCommerce product, or internal product' }
).refine(
    (item) => !item.childVariationId || Boolean(item.childProductId),
    { message: 'childVariationId requires childProductId' }
);

export const bomSaveBodySchema = z.object({
    variationId: z.coerce.number().int().nonnegative().default(0),
    items: z.array(bomItemInputSchema).max(500)
});
