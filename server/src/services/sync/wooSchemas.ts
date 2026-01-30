/**
 * WooCommerce API Response Schemas
 * Zod validation for type-safe sync payload handling
 */
import { z } from 'zod';

// --- Common Schemas ---

const WooImageSchema = z.object({
    id: z.number(),
    src: z.string().url().optional().or(z.literal('')),
    name: z.string().optional(),
    alt: z.string().optional()
}).passthrough();

const WooDimensionsSchema = z.object({
    length: z.string().optional(),
    width: z.string().optional(),
    height: z.string().optional()
}).passthrough();

const WooBillingSchema = z.object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    address_1: z.string().optional(),
    address_2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().optional()
}).passthrough();

const WooShippingSchema = WooBillingSchema.omit({ email: true, phone: true });

// --- Product Schema ---

export const WooProductSchema = z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string().optional(),
    permalink: z.string().url().optional(),
    type: z.string().optional(),
    status: z.string().optional(),
    sku: z.string().optional().nullable(),
    price: z.string().optional(),
    regular_price: z.string().optional(),
    sale_price: z.string().optional(),
    stock_status: z.string().optional(),
    stock_quantity: z.number().nullable().optional(),
    weight: z.string().optional(),
    dimensions: WooDimensionsSchema.optional(),
    images: z.array(WooImageSchema).optional(),
    categories: z.array(z.object({
        id: z.number(),
        name: z.string().optional(),
        slug: z.string().optional()
    })).optional(),
    tags: z.array(z.object({
        id: z.number(),
        name: z.string().optional(),
        slug: z.string().optional()
    })).optional(),
    date_created: z.string().optional(),
    date_modified: z.string().optional()
}).passthrough();

export type WooProduct = z.infer<typeof WooProductSchema>;

// --- Product Variation Schema ---

const WooVariationAttributeSchema = z.object({
    id: z.number(),
    name: z.string(),
    option: z.string()
}).passthrough();

export const WooProductVariationSchema = z.object({
    id: z.number(),
    sku: z.string().optional().nullable(),
    price: z.string().optional(),
    regular_price: z.string().optional(),
    sale_price: z.string().optional(),
    stock_status: z.string().optional(),
    stock_quantity: z.number().nullable().optional(),
    weight: z.string().optional(),
    dimensions: WooDimensionsSchema.optional(),
    image: WooImageSchema.optional(),
    attributes: z.array(WooVariationAttributeSchema).optional()
}).passthrough();

export type WooProductVariation = z.infer<typeof WooProductVariationSchema>;

// --- Customer Schema ---

export const WooCustomerSchema = z.object({
    id: z.number(),
    email: z.string().email().optional().or(z.literal('')),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    billing: WooBillingSchema.optional(),
    shipping: WooShippingSchema.optional(),
    total_spent: z.string().optional(),
    orders_count: z.number().optional(),
    date_created: z.string().optional(),
    date_modified: z.string().optional()
}).passthrough();

export type WooCustomer = z.infer<typeof WooCustomerSchema>;

// --- Order Schemas ---

const WooLineItemSchema = z.object({
    id: z.number(),
    name: z.string().optional(),
    product_id: z.number(),
    variation_id: z.number().optional(),
    quantity: z.number(),
    subtotal: z.string().optional(),
    total: z.string().optional(),
    sku: z.string().optional().nullable(),
    price: z.number().optional()
}).passthrough();

export const WooOrderSchema = z.object({
    id: z.number(),
    number: z.string(),
    status: z.string(),
    currency: z.string().optional(),
    total: z.string(),
    subtotal: z.string().optional(),
    total_tax: z.string().optional(),
    shipping_total: z.string().optional(),
    discount_total: z.string().optional(),
    customer_id: z.number().optional(),
    billing: WooBillingSchema.optional(),
    shipping: WooShippingSchema.optional(),
    line_items: z.array(WooLineItemSchema).optional(),
    date_created: z.string().optional(),
    date_created_gmt: z.string().optional(),
    date_modified: z.string().optional(),
    date_modified_gmt: z.string().optional(),
    date_completed: z.string().nullable().optional(),
    payment_method: z.string().optional(),
    payment_method_title: z.string().optional()
}).passthrough();

export type WooOrder = z.infer<typeof WooOrderSchema>;

// --- Review Schema ---

export const WooReviewSchema = z.object({
    id: z.number(),
    product_id: z.number(),
    product_name: z.string().optional(),
    reviewer: z.string(),
    reviewer_email: z.string().email().optional().or(z.literal('')),
    review: z.string(),
    rating: z.number().min(1).max(5),
    status: z.string(),
    date_created: z.string(),
    date_created_gmt: z.string().optional(),
    verified: z.boolean().optional()
}).passthrough();

export type WooReview = z.infer<typeof WooReviewSchema>;

// --- Safe Parse Helpers ---

export function safeParseProduct(data: unknown): WooProduct | null {
    const result = WooProductSchema.safeParse(data);
    return result.success ? result.data : null;
}

export function safeParseProducts(data: unknown[]): WooProduct[] {
    return data.map(item => safeParseProduct(item)).filter((p): p is WooProduct => p !== null);
}

export function safeParseCustomer(data: unknown): WooCustomer | null {
    const result = WooCustomerSchema.safeParse(data);
    return result.success ? result.data : null;
}

export function safeParseCustomers(data: unknown[]): WooCustomer[] {
    return data.map(item => safeParseCustomer(item)).filter((c): c is WooCustomer => c !== null);
}

export function safeParseOrder(data: unknown): WooOrder | null {
    const result = WooOrderSchema.safeParse(data);
    return result.success ? result.data : null;
}

export function safeParseOrders(data: unknown[]): WooOrder[] {
    return data.map(item => safeParseOrder(item)).filter((o): o is WooOrder => o !== null);
}

export function safeParseReview(data: unknown): WooReview | null {
    const result = WooReviewSchema.safeParse(data);
    return result.success ? result.data : null;
}

export function safeParseReviews(data: unknown[]): WooReview[] {
    return data.map(item => safeParseReview(item)).filter((r): r is WooReview => r !== null);
}

export function safeParseVariation(data: unknown): WooProductVariation | null {
    const result = WooProductVariationSchema.safeParse(data);
    return result.success ? result.data : null;
}

export function safeParseVariations(data: unknown[]): WooProductVariation[] {
    return data.map(item => safeParseVariation(item)).filter((v): v is WooProductVariation => v !== null);
}

