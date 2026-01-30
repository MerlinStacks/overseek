/**
 * Request Validation Schemas
 * 
 * Zod schemas for validating API request parameters.
 * Use these with the validate middleware for type-safe endpoints.
 */

import { z } from 'zod';

// --- Common Schemas ---

/** UUID string validation */
export const uuidSchema = z.string().uuid();

/** Pagination query params */
export const paginationSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20)
    })
});

/** Date range query params */
export const dateRangeSchema = z.object({
    query: z.object({
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        days: z.coerce.number().int().positive().max(365).default(30)
    })
});

// --- Auth Schemas ---

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

// --- Account Schemas ---

export const createAccountSchema = z.object({
    body: z.object({
        name: z.string().min(1).max(100),
        wooUrl: z.string().url(),
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

// --- Product Schemas ---

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
        price: z.coerce.number().positive().optional(),
        binLocation: z.string().max(50).optional(),
        cogs: z.coerce.number().positive().optional(),
        supplierId: z.string().uuid().nullable().optional()
    })
});

// --- Customer Schemas ---

export const customerIdSchema = z.object({
    params: z.object({
        id: z.coerce.number().int().positive()
    })
});

// --- Analytics Schemas ---

export const analyticsQuerySchema = z.object({
    query: z.object({
        days: z.coerce.number().int().positive().max(365).default(30),
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(50)
    })
});

// --- Webhook Schemas ---

export const wooWebhookSchema = z.object({
    body: z.record(z.string(), z.unknown())
});

// --- Type exports ---
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type CreateAccountInput = z.infer<typeof createAccountSchema>['body'];
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>['body'];
export type UpdateProductInput = z.infer<typeof updateProductSchema>['body'];
