/**
 * Order Data Extractor
 * 
 * Type-safe utilities for extracting data from WooCommerce order rawData.
 * Eliminates scattered `as any` casts and provides consistent access patterns.
 */

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

export function orderRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
function identifier(value: unknown): number | null {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}
export function orderMoney(value: unknown): number {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))) throw new Error('Order money is unavailable or invalid');
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error('Invalid order money');
    return number;
}

/**
 * Extract billing information from order rawData
 */
export function extractBillingInfo(order: { rawData: unknown }): OrderBillingInfo {
    const billing = orderRecord(orderRecord(order?.rawData).billing);

    return {
        email: text(billing.email)?.toLowerCase() || null,
        firstName: text(billing.first_name), lastName: text(billing.last_name), phone: text(billing.phone),
        country: text(billing.country), city: text(billing.city),
    };
}

/**
 * Extract customer ID from order rawData
 */
export function extractCustomerId(order: { rawData: unknown }): number | null {
    return identifier(orderRecord(order?.rawData).customer_id);
}

/**
 * Extract line items from order rawData
 */
export function extractLineItems(order: { rawData: unknown }): OrderLineItem[] {
    const items = orderRecord(order?.rawData).line_items;
    if (!Array.isArray(items)) throw new Error('Order line items unavailable');

    return items.map(value => {
        const item = orderRecord(value);
        const productId = identifier(item.product_id);
        const quantity = orderMoney(item.quantity);
        if (!productId || quantity < 0 || !Number.isInteger(quantity)) throw new Error('Invalid order line identity/quantity');
        if (item.variation_id != null && Number(item.variation_id) !== 0 && !identifier(item.variation_id)) throw new Error('Invalid order variation');
        return { productId, variationId: identifier(item.variation_id), name: text(item.name) || 'Unknown Product', quantity,
            total: orderMoney(item.total), sku: text(item.sku), categoryName: extractItemCategory(item) };
    });
}

/**
 * Extract category from a line item
 */
function extractItemCategory(item: any): string | null {
    // Try direct category_name field
    if (text(item.category_name)) return text(item.category_name);

    // Try meta_data
    const categoryMeta = Array.isArray(item.meta_data) ? item.meta_data.find((m: unknown) => orderRecord(m).key === 'category') : null;
    if (text(categoryMeta?.value)) return text(categoryMeta.value);

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

    return null;
}

/**
 * Calculate total revenue from line items
 */
export function calculateLineItemRevenue(order: { rawData: unknown }): number {
    const items = extractLineItems(order);
    return items.reduce((sum, item) => sum + item.total, 0);
}
