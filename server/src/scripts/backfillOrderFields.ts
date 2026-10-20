/**
 * Performance Migration: Backfill Denormalized Order Fields
 * 
 * This migration populates billingEmail, billingCountry, and wooCustomerId
 * from the rawData JSON blob for existing orders. This enables faster lookups
 * without parsing JSON in queries.
 * 
 * Runs in batches to avoid locking the table for too long.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

const BATCH_SIZE = 500;

/**
 * Backfills denormalized fields for all existing WooOrders.
 * Call this once after deploying the schema migration.
 */
export async function backfillOrderDenormalizedFields(): Promise<{ updated: number; errors: number }> {
    Logger.info('[Backfill] Starting order denormalization backfill...');

    let updated = 0;
    let errors = 0;
    let hasMore = true;
    let lastId: string | undefined;

    while (hasMore) {
        // Fetch a batch of orders that need backfilling
        // Check for null OR already processed (using cursor pagination)
        const orders = await prisma.wooOrder.findMany({
            where: {
                OR: [{ wooCustomerId: null }, { billingEmail: null }, { billingCountry: null }],
                ...(lastId ? { id: { gt: lastId } } : {})
            },
            select: { id: true, rawData: true, billingEmail: true, billingCountry: true, wooCustomerId: true },
            take: BATCH_SIZE,
            orderBy: { id: 'asc' }
        });

        if (orders.length === 0) {
            hasMore = false;
            break;
        }

        // Process batch
        for (const order of orders) {
            try {
                const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
                const raw = object(order.rawData);
                const billing = object(raw.billing);
                const email = typeof billing.email === 'string' ? billing.email.trim().toLowerCase() : '';
                const country = typeof billing.country === 'string' ? billing.country.trim().toUpperCase() : '';
                const customerId = typeof raw.customer_id === 'number' ? raw.customer_id
                    : typeof raw.customer_id === 'string' && /^\d+$/.test(raw.customer_id.trim()) ? Number(raw.customer_id) : NaN;
                const data: { billingEmail?: string; billingCountry?: string; wooCustomerId?: number } = {};
                if (order.billingEmail == null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) data.billingEmail = email;
                if (order.billingCountry == null && /^[A-Z]{2}$/.test(country)) data.billingCountry = country;
                if (order.wooCustomerId == null && Number.isSafeInteger(customerId) && customerId > 0 && customerId <= 2147483647) data.wooCustomerId = customerId;
                // Guests and incomplete raw records may remain eligible; do not rewrite unchanged rows.
                if (Object.keys(data).length === 0) continue;
                const result = await prisma.wooOrder.updateMany({
                    where: {
                        id: order.id,
                        ...(data.billingEmail ? { billingEmail: null } : {}),
                        ...(data.billingCountry ? { billingCountry: null } : {}),
                        ...(data.wooCustomerId ? { wooCustomerId: null } : {}),
                    },
                    data,
                });
                // Conditional writes also protect values populated by a concurrent order sync.
                updated += result.count;
            } catch (error) {
                errors++;
                Logger.warn('[Backfill] Failed to update order', { orderId: order.id, error });
            }
        }

        lastId = orders[orders.length - 1].id;
        Logger.info(`[Backfill] Processed ${updated} orders so far...`);
    }

    Logger.info('[Backfill] Order denormalization complete', { updated, errors });
    return { updated, errors };
}

// Export for use in startup or CLI
export default backfillOrderDenormalizedFields;
