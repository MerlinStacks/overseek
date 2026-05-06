import { z } from 'zod';

export const createInternalProductSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Name is required'),
        sku: z.string().optional(),
        description: z.string().optional(),
        stockQuantity: z.number().int().optional(),
        cogs: z.number().optional(),
        binLocation: z.string().optional(),
        mainImage: z.string().url().optional().or(z.literal('')),
        images: z.array(z.string().url()).optional(),
        supplierId: z.string().uuid().optional(),
    }),
});

export const updateInternalProductSchema = z.object({
    params: z.object({
        id: z.string().uuid(),
    }),
    body: z.object({
        name: z.string().min(1).optional(),
        sku: z.string().optional(),
        description: z.string().optional(),
        stockQuantity: z.number().int().optional(),
        cogs: z.number().optional(),
        binLocation: z.string().optional(),
        mainImage: z.string().url().optional().or(z.literal('')),
        images: z.array(z.string().url()).optional(),
        supplierId: z.string().uuid().optional().nullable(),
    }),
});

export const adjustStockSchema = z.object({
    params: z.object({
        id: z.string().uuid(),
    }),
    body: z.object({
        adjustment: z.number().int(),
        reason: z.string().min(1, 'Reason is required'),
    }),
});
