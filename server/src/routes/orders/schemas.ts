import { z } from 'zod';

export const orderIdParamSchema = z.object({
    id: z.union([
        z.string().uuid(),
        z.string().max(10).regex(/^[1-9]\d*$/, 'ID must be a UUID or a positive WooCommerce ID').refine(value => Number(value) <= 2147483647, 'WooCommerce ID exceeds supported range')
    ])
});
