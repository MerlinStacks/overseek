/**
 * Order Data Extractor
 * 
 * Type-safe utilities for extracting data from WooCommerce order rawData.
 * Eliminates scattered `as any` casts and provides consistent access patterns.
 */

import { WooOrder } from '@prisma/client';

/**
 * Structured billing info from order rawData
 */
export interface OrderBillingInfo {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    country: string | null;
    city: string | null;
}

/**
 * Structured line item from order rawData
 */
export interface OrderLineItem {
    productId: number;
    variationId: number | null;
    name: string;
    quantity: number;
    total: number;
    sku: string | null;
    categoryName: string | null;
}

/**
 * Extract billing information from order rawData
 */
export function extractBillingInfo(order: { rawData: unknown }): OrderBillingInfo {
    const raw = order.rawData as Record<string, any> | null;
    const billing = raw?.billing || {};

    return {
        email: billing.email?.toLowerCase() || null,
        firstName: billing.first_name || null,
        lastName: billing.last_name || null,
        phone: billing.phone || null,
        country: billing.country || null,
        city: billing.city || null,
    };
}

/**
 * Extract customer ID from order rawData
 */
export function extractCustomerId(order: { rawData: unknown }): number | null {
    const raw = order.rawData as Record<string, any> | null;
    return raw?.customer_id || null;
}

/**
 * Extract line items from order rawData
 */
export function extractLineItems(order: { rawData: unknown }): OrderLineItem[] {
    const raw = order.rawData as Record<string, any> | null;
    const items = raw?.line_items || [];

    return items.map((item: any) => ({
        productId: item.product_id || 0,
        variationId: item.variation_id || null,
        name: item.name || 'Unknown Product',
        quantity: item.quantity || 0,
        total: parseFloat(item.total) || 0,
        sku: item.sku || null,
        categoryName: extractItemCategory(item),
    }));
}

/**
 * Extract category from a line item
 */
function extractItemCategory(item: any): string | null {
    // Try direct category_name field
    if (item.category_name) return item.category_name;

    // Try meta_data
    const categoryMeta = item.meta_data?.find((m: any) => m.key === 'category');
    if (categoryMeta?.value) return categoryMeta.value;

    return null;
}

/**
 * Get the first product category from an order's line items
 */
export function getFirstProductCategory(order: { rawData: unknown }): string | null {
    const items = extractLineItems(order);

    for (const item of items) {
        if (item.categoryName) return item.categoryName;
    }

    // Return the first product name for category inference
    return items[0]?.name || null;
}

/**
 * Calculate total revenue from line items
 */
export function calculateLineItemRevenue(order: { rawData: unknown }): number {
    const items = extractLineItems(order);
    return items.reduce((sum, item) => sum + item.total, 0);
}
