
/**
 * Centralized Order Status Constants
 * 
 * Used for consistency across Analytics, Inventory, and Product services.
 * Includes legacy mixed-case variants to support historical data.
 */

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
