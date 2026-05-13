
/**
 * Centralized Order Status Constants
 *
 * Used for consistency across Analytics, Inventory, and Product services.
 * Includes legacy mixed-case variants to support historical data.
 */

export const EXCLUDED_ORDER_STATUSES = new Set(['trash', 'auto-draft', 'checkout-draft']);

export const ORDER_STATUS_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export const normalizeOrderStatus = (status: unknown): string => {
    if (typeof status !== 'string') return '';
    return status.trim().toLowerCase();
};

export const isExcludedOrderStatus = (status: unknown): boolean => {
    const normalized = normalizeOrderStatus(status);
    return !normalized || EXCLUDED_ORDER_STATUSES.has(normalized);
};

export const isValidWooOrderStatusSlug = (status: unknown): boolean => {
    const normalized = normalizeOrderStatus(status);
    if (!normalized) return false;
    return ORDER_STATUS_SLUG_REGEX.test(normalized) && !EXCLUDED_ORDER_STATUSES.has(normalized);
};

export const REVENUE_STATUSES = [
    'completed',
    'processing',
    'on-hold',
    'pending',
    // Legacy mixed-case support
    'Completed',
    'Processing',
    'On-hold',
    'Pending'
];
