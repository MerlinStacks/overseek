/**
 * Request Validation Schemas
 * 
 * Zod schemas for validating API request parameters.
 * Use these with the validate middleware for type-safe endpoints.
 */

import { z } from 'zod';

/** UUID string validation */
export const uuidSchema = z.string().uuid();
const inputNumber = z.union([z.number(), z.string().trim().min(1).pipe(z.coerce.number())]);
const inputDate = z.union([z.date(), z.string().trim().min(1).pipe(z.coerce.date())]);
const websiteUrl = z.string().trim().url().refine(value => {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
}, 'Use an HTTP or HTTPS URL without credentials');

/** Pagination query params */
export const paginationSchema = z.object({
    query: z.object({
        page: inputNumber.pipe(z.number().int().positive()).default(1),
        limit: inputNumber.pipe(z.number().int().positive().max(100)).default(20)
    })
});

/** Date range query params */
export const dateRangeSchema = z.object({
    query: z.object({
        startDate: inputDate.optional(),
        endDate: inputDate.optional(),
        days: z.coerce.number().int().positive().max(365).default(30)
    }).refine(query => !query.startDate || !query.endDate || query.startDate <= query.endDate, { message: 'Start date must not follow end date', path: ['endDate'] })
});

export const loginSchema = z.object({
    body: z.object({
        email: z.string().email(),
        password: z.string().min(8)
    })
});

export const registerSchema = z.object({
    body: z.object({
        email: z.string().email(),
        password: z.string().min(8),
        fullName: z.string().min(1).max(100)
    })
});

export const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string(),
        password: z.string().min(8)
    })
});

export const createAccountSchema = z.object({
    body: z.object({
        name: z.string().min(1).max(100),
        wooUrl: websiteUrl,
        wooConsumerKey: z.string().min(10),
        wooConsumerSecret: z.string().min(10)
    })
});

export const updateAccountSchema = z.object({
    body: z.object({
        name: z.string().min(1).max(100).optional(),
        currency: z.string().length(3).optional(),
        timezone: z.string().optional(),
        appearance: z.record(z.string(), z.unknown()).optional()
    })
});

export const productIdSchema = z.object({
    params: z.object({
        id: z.coerce.number().int().positive()
    })
});

export const updateProductSchema = z.object({
    params: z.object({
        id: z.coerce.number().int().positive()
    }),
    body: z.object({
        name: z.string().optional(),
        price: inputNumber.pipe(z.number().nonnegative()).optional(),
        binLocation: z.string().max(50).optional(),
        cogs: inputNumber.pipe(z.number().nonnegative()).optional(),
        supplierId: z.string().uuid().nullable().optional()
    })
});

export const customerIdSchema = z.object({
    params: z.object({
        id: z.coerce.number().int().positive()
    })
});

export const analyticsQuerySchema = z.object({
    query: z.object({
        days: z.coerce.number().int().positive().max(365).default(30),
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(50)
    })
});

export const wooWebhookSchema = z.object({
    body: z.record(z.string(), z.unknown())
});

// --- Type exports ---
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type CreateAccountInput = z.infer<typeof createAccountSchema>['body'];
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>['body'];
export type UpdateProductInput = z.infer<typeof updateProductSchema>['body'];
