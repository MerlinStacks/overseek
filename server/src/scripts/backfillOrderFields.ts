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
                // Only process orders that haven't been touched yet (wooCustomerId is also null)
                wooCustomerId: null,
                ...(lastId ? { id: { gt: lastId } } : {})
            },
            select: { id: true, rawData: true },
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
                const raw = order.rawData as any;
                // Normalize email: lowercase, trim, convert empty strings to null
                const rawEmail = raw?.billing?.email;
                const billingEmail = rawEmail && rawEmail.trim() ? rawEmail.toLowerCase().trim() : null;
                const billingCountry = raw?.billing?.country || null;
                const wooCustomerId = raw?.customer_id > 0 ? raw.customer_id : null;

                await prisma.wooOrder.update({
                    where: { id: order.id },
                    data: { billingEmail, billingCountry, wooCustomerId }
                });
                updated++;
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
