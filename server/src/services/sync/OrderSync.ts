import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma, Prisma } from '../../utils/prisma';
import { IndexingService } from '../search/IndexingService';
import { OrderTaggingService } from '../OrderTaggingService';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { WooOrderSchema, WooOrder } from './wooSchemas';
import { esClient } from '../../utils/elastic';

/** Standard WooCommerce statuses we track. Others are skipped during sync. */
const VALID_ORDER_STATUSES = new Set([
    'pending', 'processing', 'on-hold', 'completed',
    'cancelled', 'refunded', 'failed'
]);

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
        let expectedTotal = 0;

        while (hasMore) {
            const { data: rawOrders, totalPages, total } = await woo.getOrders({ page, after, per_page: 100 });
            if (page === 1) expectedTotal = total;
            if (!rawOrders.length) {
                hasMore = false;
                break;
            }


            const orders: WooOrder[] = [];
            for (const raw of rawOrders) {
                const result = WooOrderSchema.safeParse(raw);
                if (result.success) {
                    if (!VALID_ORDER_STATUSES.has(result.data.status.toLowerCase())) {
                        totalSkipped++;
                        Logger.debug('Skipping order with non-standard status', {
                            accountId, syncId, orderId: result.data.id,
                            status: result.data.status
                        });
                        continue;
                    }
                    orders.push(result.data);
                } else {
                    totalSkipped++;
                    Logger.debug(`Skipping invalid order`, {
                        accountId, syncId, orderId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!orders.length) {
                page++;
                continue;
            }


            const existingOrders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    wooId: { in: orders.map((o) => o.id) }
                },
                select: { wooId: true, status: true }
            });
            const existingMap = new Map(existingOrders.map(o => [o.wooId, o.status]));

            // Batch upserts in transaction chunks of 50 (matches CustomerSync pattern)
            const UPSERT_CHUNK_SIZE = 50;
            for (let i = 0; i < orders.length; i += UPSERT_CHUNK_SIZE) {
                const chunk = orders.slice(i, i + UPSERT_CHUNK_SIZE);

                for (const order of chunk) {
                    wooOrderIds.add(order.id);
                }

                // Execute batch upserts concurrently (no transaction — each upsert is idempotent)
                await Promise.all(
                    chunk.map((order) => {
                        const rawEmail = (order as any).billing?.email;
                        const billingEmail = rawEmail && rawEmail.trim() ? rawEmail.toLowerCase().trim() : null;
                        const billingCountry = (order as any).billing?.country || null;
                        const wooCustomerId = (order as any).customer_id > 0 ? (order as any).customer_id : null;

                        return prisma.wooOrder.upsert({
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
                        }).catch((err) => {
                            Logger.warn('Failed to upsert order', {
                                accountId, syncId, wooId: order.id, error: err.message
                            });
                        });
                    })
                );
            }


            let orderTagsMap: Map<number, string[]> | undefined;
            try {
                orderTagsMap = await OrderTaggingService.extractTagsForOrders(accountId, orders);
            } catch (error: any) {
                Logger.warn('Failed to batch extract tags, falling back to individual extraction', { accountId, syncId, error: error.message });
            }


            // Build tags map (batch or individual fallback)
            const tagMappings = await OrderTaggingService.getTagMappings(accountId);
            const finalTagsMap = new Map<number, string[]>();

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

                // Why gated: emitting for every order on every sync cycle causes
                // redundant BOM consumption checks. Only new/changed orders matter.
                if (isNew || isStatusChanged) {
                    EventBus.emit(EVENTS.ORDER.SYNCED, { accountId, order });
                }

                // Resolve tags
                if (orderTagsMap) {
                    finalTagsMap.set(order.id, orderTagsMap.get(order.id) || []);
                } else {
                    try {
                        const tags = await OrderTaggingService.extractTagsFromOrder(accountId, order, tagMappings);
                        finalTagsMap.set(order.id, tags);
                    } catch { finalTagsMap.set(order.id, []); }
                }
            }

            // Bulk index entire page in one ES call
            try {
                await IndexingService.bulkIndexOrders(accountId, orders, finalTagsMap);
            } catch (error: any) {
                Logger.warn('Bulk index orders failed, skipping ES indexing for this page', { accountId, syncId, error: error.message });
            }
            totalProcessed += orders.length;

            Logger.info(`Synced batch of ${orders.length} orders`, { accountId, syncId, page, totalPages, skipped: totalSkipped });

            // use WooCommerce's x-wp-totalpages header instead of checking batch size
            // (batch size is unreliable due to WC filtering and Zod validation skips)
            if (page >= totalPages) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;
        }

        // reconciliation: remove orders that no longer exist in Woo (full sync only)
        if (!incremental && wooOrderIds.size > 0) {
            const localOrders = await prisma.wooOrder.findMany({
                where: { accountId },
                select: { wooId: true }
            });

            const wooIdsToDelete = localOrders
                .filter(local => !wooOrderIds.has(local.wooId))
                .map(local => local.wooId);

            if (wooIdsToDelete.length > 0) {

                const deleteIndexPromises = wooIdsToDelete.map(wooId =>
                    IndexingService.deleteOrder(accountId, wooId)
                );
                await Promise.allSettled(deleteIndexPromises);


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

        // Summary log: makes incomplete syncs visible in logs
        if (expectedTotal > 0 && totalProcessed < expectedTotal) {
            Logger.warn(`Order sync incomplete: processed ${totalProcessed}/${expectedTotal} orders (${totalSkipped} skipped)`, {
                accountId, syncId, expectedTotal, totalProcessed, totalSkipped, incremental
            });
        } else {
            Logger.info(`Order sync complete: ${totalProcessed}/${expectedTotal} orders processed`, {
                accountId, syncId, totalDeleted, totalSkipped, incremental
            });
        }

        await this.recalculateCustomerCounts(accountId, syncId);

        // After a full sync, refresh ES indices to ensure all changes (including deletes) are searchable
        if (!incremental) {
            try {
                await esClient.indices.refresh({ index: 'orders' });
                Logger.info('Refreshed ES orders index after full sync', { accountId, syncId });
            } catch (error: any) {
                Logger.warn('Failed to refresh ES orders index', { accountId, syncId, error: error.message });
            }
        }

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }

    /**
     * Recalculate customer order counts using a two-step approach to avoid deadlocks.
     * Why: The previous single-transaction UPDATE...FROM...JOIN held row locks on all
     * WooCustomer rows simultaneously, causing deadlocks (40P01) when concurrent syncs
     * ran. This new approach reads counts first, then applies in small batches.
     */
    protected async recalculateCustomerCounts(accountId: string, syncId?: string): Promise<void> {
        Logger.info('Recalculating customer order counts from local orders...', { accountId, syncId });

        try {
            // Step 1: Read counts (no locks held)
            const counts = await prisma.$queryRaw<Array<{ woo_id: number; count: number }>>`
                SELECT
                    "wooCustomerId" as woo_id,
                    COUNT(*)::int as count
                FROM "WooOrder"
                WHERE "accountId" = ${accountId}
                  AND "wooCustomerId" IS NOT NULL
                GROUP BY "wooCustomerId"
            `;

            if (counts.length === 0) {
                Logger.info('No customer order counts to update', { accountId, syncId });
                return;
            }

            // Step 2: Apply in small batches to minimize lock duration
            const BATCH_SIZE = 50;
            let updated = 0;

            for (let i = 0; i < counts.length; i += BATCH_SIZE) {
                const batch = counts.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(c =>
                    prisma.wooCustomer.updateMany({
                        where: { accountId, wooId: c.woo_id },
                        data: { ordersCount: c.count }
                    }).catch(err => {
                        Logger.warn('Failed to update order count for customer', {
                            accountId, syncId, wooId: c.woo_id, error: err.message
                        });
                    })
                ));
                updated += batch.length;
            }

            Logger.info(`Updated customer order counts: ${updated} customers`, { accountId, syncId });

        } catch (error: any) {
            // Non-fatal — don't break the sync for a count mismatch
            Logger.warn('Failed to recalculate customer order counts', {
                accountId, syncId, error: error.message
            });
        }
    }
}
