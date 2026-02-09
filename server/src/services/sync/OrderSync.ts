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
            const { data: rawOrders, totalPages } = await woo.getOrders({ page, after, per_page: 100 });
            if (!rawOrders.length) {
                hasMore = false;
                break;
            }


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

                await prisma.$transaction(
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

                EventBus.emit(EVENTS.ORDER.SYNCED, { accountId, order });

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


        await this.recalculateCustomerCounts(accountId, syncId);

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }

    /**
     * recalculate customer order counts using a pg advisory lock
     * to avoid deadlocks when multiple workers run concurrently.
     * uses the indexed wooCustomerId column instead of JSON parsing.
     */
    protected async recalculateCustomerCounts(accountId: string, syncId?: string): Promise<void> {
        Logger.info('Recalculating customer order counts from local orders...', { accountId, syncId });

        const MAX_RETRIES = 3;
        let attempt = 0;

        while (attempt < MAX_RETRIES) {
            try {
                // advisory lock prevents deadlocks (40P01) when multiple sync jobs hit the same rows
                await prisma.$transaction(async (tx) => {

                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('recalculate_customer_counts_' || ${accountId}))`;


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
                    timeout: 15000,
                    maxWait: 5000
                });

                Logger.info(`Updated customer order counts`, { accountId, syncId });
                return;

            } catch (error: any) {
                attempt++;
                const isDeadlock = error.code === '40P01';
                const isTimeout = error.code === 'P2024' || error.message?.includes('timeout');

                if ((isDeadlock || isTimeout) && attempt < MAX_RETRIES) {
                    // backoff: 500ms, 1s, 2s
                    const backoffMs = 500 * Math.pow(2, attempt - 1);
                    Logger.warn(`Customer count recalculation ${isDeadlock ? 'deadlock' : 'timeout'}, retrying in ${backoffMs}ms...`, {
                        accountId, syncId, attempt, maxRetries: MAX_RETRIES
                    });
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                } else {

                    Logger.warn('Failed to recalculate customer order counts', {
                        accountId, syncId, error: error.message, attempts: attempt
                    });
                    return; // non-fatal — don't break the sync
                }
            }
        }
    }
}
