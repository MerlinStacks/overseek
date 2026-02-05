import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma, Prisma } from '../../utils/prisma';
import { IndexingService } from '../search/IndexingService';
import { OrderTaggingService } from '../OrderTaggingService';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { WooOrderSchema, WooOrder } from './wooSchemas';


export class OrderSync extends BaseSync {
    protected entityType = 'orders';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;

        const wooOrderIds = new Set<number>();

        while (hasMore) {
            const { data: rawOrders, totalPages } = await woo.getOrders({ page, after, per_page: 25 });
            if (!rawOrders.length) {
                hasMore = false;
                break;
            }

            // Validate orders with Zod schema
            const orders: WooOrder[] = [];
            for (const raw of rawOrders) {
                const result = WooOrderSchema.safeParse(raw);
                if (result.success) {
                    orders.push(result.data);
                } else {
                    totalSkipped++;
                    Logger.warn(`Skipping invalid order`, {
                        accountId, syncId, orderId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!orders.length) {
                page++;
                continue;
            }

            // Get existing orders for change detection
            const existingOrders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    wooId: { in: orders.map((o) => o.id) }
                },
                select: { wooId: true, status: true }
            });
            const existingMap = new Map(existingOrders.map(o => [o.wooId, o.status]));

            // Use interactive transaction with extended timeout (30s) to handle heavy load.
            // Batch transactions ($transaction([...ops])) don't support the timeout option.
            // Under load with Redis issues, even small batches can exceed the default 5s timeout.
            const UPSERT_CHUNK_SIZE = 10;
            for (let i = 0; i < orders.length; i += UPSERT_CHUNK_SIZE) {
                const chunk = orders.slice(i, i + UPSERT_CHUNK_SIZE);

                // Track IDs before transaction for recovery in case of failure
                for (const order of chunk) {
                    wooOrderIds.add(order.id);
                }

                await prisma.$transaction(
                    async (tx) => {
                        for (const order of chunk) {
                            // Extract denormalized fields for performance (avoids JSON parsing in queries)
                            // Normalize email to lowercase for consistent indexed lookups
                            const rawEmail = (order as any).billing?.email;
                            const billingEmail = rawEmail && rawEmail.trim() ? rawEmail.toLowerCase().trim() : null;
                            const billingCountry = (order as any).billing?.country || null;
                            const wooCustomerId = (order as any).customer_id > 0 ? (order as any).customer_id : null;

                            await tx.wooOrder.upsert({
                                where: { accountId_wooId: { accountId, wooId: order.id } },
                                update: {
                                    status: order.status.toLowerCase(),
                                    total: order.total === '' ? '0' : order.total,
                                    currency: order.currency,
                                    billingEmail,
                                    billingCountry,
                                    wooCustomerId,
                                    dateModified: new Date(order.date_modified_gmt || order.date_modified || new Date()),
                                    rawData: order as any
                                },
                                create: {
                                    accountId,
                                    wooId: order.id,
                                    number: order.number,
                                    status: order.status.toLowerCase(),
                                    total: order.total === '' ? '0' : order.total,
                                    currency: order.currency,
                                    billingEmail,
                                    billingCountry,
                                    wooCustomerId,
                                    dateCreated: new Date(order.date_created_gmt || order.date_created || new Date()),
                                    dateModified: new Date(order.date_modified_gmt || order.date_modified || new Date()),
                                    rawData: order as any
                                }
                            });
                        }
                    },
                    {
                        timeout: 30000, // 30 seconds - sufficient for 10 upserts under heavy load
                        maxWait: 10000  // Max 10s to acquire a connection from the pool
                    }
                );
            }

            // Fetch tags for all orders in batch
            let orderTagsMap: Map<number, string[]> | undefined;
            try {
                orderTagsMap = await OrderTaggingService.extractTagsForOrders(accountId, orders);
            } catch (error: any) {
                Logger.warn('Failed to batch extract tags, falling back to individual extraction', { accountId, syncId, error: error.message });
            }

            // Process events and indexing
            const indexPromises: Promise<any>[] = [];

            // Optimization: Fetch tag mappings once for the batch
            const tagMappings = await OrderTaggingService.getTagMappings(accountId);

            for (const order of orders) {
                const existingStatus = existingMap.get(order.id);
                const isNew = !existingStatus;
                const isStatusChanged = existingStatus && existingStatus !== order.status;

                const orderDate = new Date(order.date_created_gmt || order.date_created || new Date());
                const isRecent = (new Date().getTime() - orderDate.getTime()) < 24 * 60 * 60 * 1000;

                if (isNew && isRecent) {
                    EventBus.emit(EVENTS.ORDER.CREATED, { accountId, order });
                }

                if (order.status.toLowerCase() === 'completed' && (isNew || isStatusChanged)) {
                    EventBus.emit('order:completed', { accountId, order });
                }

                EventBus.emit(EVENTS.ORDER.SYNCED, { accountId, order });

                indexPromises.push((async () => {
                    try {
                        let tags: string[];
                        if (orderTagsMap) {
                            // Best performance: use pre-extracted batch tags
                            tags = orderTagsMap.get(order.id) || [];
                        } else {
                            // Fallback with tagMappings optimization
                            tags = await OrderTaggingService.extractTagsFromOrder(accountId, order, tagMappings);
                        }
                        await IndexingService.indexOrder(accountId, order, tags);
                    } catch (error: any) {
                        Logger.warn(`Failed to index order ${order.id}`, { accountId, syncId, error: error.message });
                    }
                })());
            }

            await Promise.allSettled(indexPromises);
            totalProcessed += orders.length;

            Logger.info(`Synced batch of ${orders.length} orders`, { accountId, syncId, page, totalPages, skipped: totalSkipped });

            // Use totalPages from WooCommerce API headers (x-wp-totalpages) instead of batch-size heuristic
            // The old `orders.length < 25` check was unreliable because:
            // 1. WooCommerce may return fewer items due to internal filtering
            // 2. Zod validation may skip invalid orders, reducing the count
            if (page >= totalPages) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;
        }

        // --- Reconciliation: Remove deleted orders ---
        // Only run on full sync (non-incremental) to ensure we have all WooCommerce IDs
        if (!incremental && wooOrderIds.size > 0) {
            const localOrders = await prisma.wooOrder.findMany({
                where: { accountId },
                select: { wooId: true }
            });

            const wooIdsToDelete = localOrders
                .filter(local => !wooOrderIds.has(local.wooId))
                .map(local => local.wooId);

            if (wooIdsToDelete.length > 0) {
                // Batch delete from the search index first
                const deleteIndexPromises = wooIdsToDelete.map(wooId =>
                    IndexingService.deleteOrder(accountId, wooId)
                );
                await Promise.allSettled(deleteIndexPromises);

                // Then, bulk delete from the database
                const { count } = await prisma.wooOrder.deleteMany({
                    where: {
                        accountId,
                        wooId: { in: wooIdsToDelete }
                    }
                });
                totalDeleted = count;

                Logger.info(`Reconciliation: Deleted ${totalDeleted} orphaned orders`, { accountId, syncId });
            }
        }

        // --- Auto-Link: Link guest orders to registered customers by email ---
        // EDGE CASE FIX: Guest checkout orders (customer_id=0) don't link when customer registers later
        const linkedOrderCount = await this.linkGuestOrdersToCustomers(accountId, syncId);
        if (linkedOrderCount > 0) {
            Logger.info(`Auto-linked ${linkedOrderCount} guest orders to customers`, { accountId, syncId });
        }

        // After all orders are synced, recalculate customer order counts from local data
        await this.recalculateCustomerCounts(accountId, syncId);

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }

    /**
     * Recalculate customer order counts from local orders.
     * Uses PostgreSQL advisory lock to prevent deadlocks when multiple workers
     * attempt to run this concurrently (fixes 40P01 deadlock errors).
     * Includes retry logic with exponential backoff for transient failures.
     * 
     * EDGE CASE: On exhausted retries, adds account to maintenance queue for later retry.
     * 
     * PERFORMANCE: Uses indexed wooCustomerId column instead of JSON parsing.
     */
    protected async recalculateCustomerCounts(accountId: string, syncId?: string): Promise<void> {
        Logger.info('Recalculating customer order counts from local orders...', { accountId, syncId });

        const MAX_RETRIES = 3;
        let attempt = 0;

        while (attempt < MAX_RETRIES) {
            try {
                // Use advisory lock to prevent concurrent execution across workers
                // This prevents deadlocks (40P01) when multiple sync jobs try to update the same rows
                await prisma.$transaction(async (tx) => {
                    // Acquire transaction-scoped advisory lock (released automatically on commit/rollback)
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('recalculate_customer_counts_' || ${accountId}))`;

                    // Now safe to run the update without risk of deadlock
                    // Uses indexed wooCustomerId column for better performance (avoids JSON parsing)
                    await tx.$executeRaw`
                        UPDATE "WooCustomer" wc
                        SET "ordersCount" = c.count
                        FROM (
                            SELECT
                                "wooCustomerId" as woo_id,
                                COUNT(*)::int as count
                            FROM "WooOrder"
                            WHERE "accountId" = ${accountId}
                              AND "wooCustomerId" IS NOT NULL
                            GROUP BY "wooCustomerId"
                        ) c
                        WHERE wc."accountId" = ${accountId}
                          AND wc."wooId" = c.woo_id;
                    `;
                }, {
                    timeout: 15000, // 15 seconds - sufficient for the update
                    maxWait: 5000   // Max 5s to acquire a connection
                });

                Logger.info(`Updated customer order counts`, { accountId, syncId });
                return; // Success - exit retry loop

            } catch (error: any) {
                attempt++;
                const isDeadlock = error.code === '40P01';
                const isTimeout = error.code === 'P2024' || error.message?.includes('timeout');

                if ((isDeadlock || isTimeout) && attempt < MAX_RETRIES) {
                    // Exponential backoff: 500ms, 1000ms, 2000ms
                    const backoffMs = 500 * Math.pow(2, attempt - 1);
                    Logger.warn(`Customer count recalculation ${isDeadlock ? 'deadlock' : 'timeout'}, retrying in ${backoffMs}ms...`, {
                        accountId, syncId, attempt, maxRetries: MAX_RETRIES
                    });
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                } else {
                    // EDGE CASE FIX: On final failure, add to maintenance queue for later retry
                    // This prevents permanent data inconsistency from exhausted retries
                    Logger.warn('Failed to recalculate customer order counts, adding to maintenance queue', {
                        accountId, syncId, error: error.message, attempts: attempt
                    });

                    // Add to Redis set for maintenance job to pick up later
                    try {
                        const { redisClient } = await import('../../utils/redis');
                        await redisClient.sadd('maintenance:customer_count_recalc', accountId);
                        Logger.info('Account added to maintenance queue for customer count recalculation', { accountId });
                    } catch (redisError) {
                        // If Redis fails too, we've done our best - log for manual intervention
                        Logger.error('Failed to add account to maintenance queue', {
                            accountId, syncId, redisError: redisError instanceof Error ? redisError.message : 'Unknown'
                        });
                    }

                    return; // Don't throw - this shouldn't break the sync
                }
            }
        }
    }

    /**
     * EDGE CASE FIX: Link guest orders to registered customers by email.
     * 
     * When a customer places a guest order and later registers, the order should
     * be associated with their account for accurate order history and analytics.
     * 
     * @returns Number of orders linked
     */
    private async linkGuestOrdersToCustomers(accountId: string, syncId?: string): Promise<number> {
        // Find guest orders (wooCustomerId is null but billingEmail exists)
        const guestOrders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                wooCustomerId: null,
                billingEmail: { not: null }
            },
            select: { id: true, billingEmail: true }
        });

        if (guestOrders.length === 0) return 0;

        // Build a map of email -> order IDs
        const emailToOrderIds = new Map<string, string[]>();
        for (const order of guestOrders) {
            if (!order.billingEmail) continue;
            const email = order.billingEmail.toLowerCase();
            if (!emailToOrderIds.has(email)) {
                emailToOrderIds.set(email, []);
            }
            emailToOrderIds.get(email)!.push(order.id);
        }

        // Find matching customers by email
        const emails = Array.from(emailToOrderIds.keys());
        const matchingCustomers = await prisma.wooCustomer.findMany({
            where: {
                accountId,
                email: { in: emails, mode: 'insensitive' }
            },
            select: { wooId: true, email: true }
        });

        let linkedCount = 0;
        for (const customer of matchingCustomers) {
            const orderIds = emailToOrderIds.get(customer.email.toLowerCase());
            if (!orderIds || orderIds.length === 0) continue;

            // Update all matching orders to link to this customer's wooId
            const result = await prisma.wooOrder.updateMany({
                where: { id: { in: orderIds } },
                data: { wooCustomerId: customer.wooId }
            });

            linkedCount += result.count;
            Logger.debug(`Linked ${result.count} guest orders to customer`, {
                accountId, syncId, customerEmail: customer.email, wooCustomerId: customer.wooId
            });
        }

        return linkedCount;
    }
}
