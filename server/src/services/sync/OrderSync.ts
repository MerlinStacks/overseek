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
                            await tx.wooOrder.upsert({
                                where: { accountId_wooId: { accountId, wooId: order.id } },
                                update: {
                                    status: order.status.toLowerCase(),
                                    total: order.total === '' ? '0' : order.total,
                                    currency: order.currency,
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

        // After all orders are synced, recalculate customer order counts from local data
        await this.recalculateCustomerCounts(accountId, syncId);

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }

    protected async recalculateCustomerCounts(accountId: string, syncId?: string): Promise<void> {
        Logger.info('Recalculating customer order counts from local orders...', { accountId, syncId });
        try {
            await prisma.$executeRaw`
                UPDATE "WooCustomer" wc
                SET "ordersCount" = c.count
                FROM (
                    SELECT
                        ("rawData"->>'customer_id')::int as woo_id,
                        COUNT(*)::int as count
                    FROM "WooOrder"
                    WHERE "accountId" = ${accountId}
                      AND "rawData"->>'customer_id' IS NOT NULL
                      AND "rawData"->>'customer_id' != '0'
                    GROUP BY "rawData"->>'customer_id'
                ) c
                WHERE wc."accountId" = ${accountId}
                  AND wc."wooId" = c.woo_id;
            `;
            Logger.info(`Updated customer order counts`, { accountId, syncId });
        } catch (error: any) {
            Logger.warn('Failed to recalculate customer order counts', { accountId, syncId, error: error.message });
        }
    }
}
