import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
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

            // Batch prepare upsert operations
            const upsertOperations = orders.map((order) => {
                wooOrderIds.add(order.id);
                return prisma.wooOrder.upsert({
                    where: { accountId_wooId: { accountId, wooId: order.id } },
                    update: {
                        status: order.status.toLowerCase(),
                        total: order.total === '' ? '0' : order.total,
                        currency: order.currency,
                        dateModified: new Date(order.date_modified || new Date()),
                        rawData: order as any
                    },
                    create: {
                        accountId,
                        wooId: order.id,
                        number: order.number,
                        status: order.status.toLowerCase(),
                        total: order.total === '' ? '0' : order.total,
                        currency: order.currency,
                        dateCreated: new Date(order.date_created || new Date()),
                        dateModified: new Date(order.date_modified || new Date()),
                        rawData: order as any
                    }
                });
            });

            // Execute batch transaction
            await prisma.$transaction(upsertOperations);

            // Process events and indexing
            const indexPromises: Promise<any>[] = [];

            // Optimization: Fetch tag mappings once for the batch
            const tagMappings = await OrderTaggingService.getTagMappings(accountId);

            for (const order of orders) {
                const existingStatus = existingMap.get(order.id);
                const isNew = !existingStatus;
                const isStatusChanged = existingStatus && existingStatus !== order.status;

                const orderDate = new Date(order.date_created || new Date());
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
                        const tags = await OrderTaggingService.extractTagsFromOrder(accountId, order, tagMappings);
                        await IndexingService.indexOrder(accountId, order, tags);
                    } catch (error: any) {
                        Logger.warn(`Failed to index order ${order.id}`, { accountId, syncId, error: error.message });
                    }
                })());
            }

            await Promise.allSettled(indexPromises);
            totalProcessed += orders.length;

            Logger.info(`Synced batch of ${orders.length} orders`, { accountId, syncId, page, totalPages, skipped: totalSkipped });
            if (orders.length < 25) hasMore = false;

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
                select: { id: true, wooId: true }
            });

            const deletePromises: Promise<any>[] = [];
            for (const local of localOrders) {
                if (!wooOrderIds.has(local.wooId)) {
                    // Order exists locally but not in WooCommerce - delete it
                    deletePromises.push(
                        prisma.wooOrder.delete({ where: { id: local.id } })
                            .then(() => IndexingService.deleteOrder(accountId, local.wooId))
                    );
                    totalDeleted++;
                }
            }

            if (deletePromises.length > 0) {
                await Promise.allSettled(deletePromises);
                Logger.info(`Reconciliation: Deleted ${totalDeleted} orphaned orders`, { accountId, syncId });
            }
        }

        // After all orders are synced, recalculate customer order counts from local data
        Logger.info('Recalculating customer order counts from local orders...', { accountId, syncId });
        try {
            const ordersWithCustomers = await prisma.wooOrder.findMany({
                where: { accountId },
                select: { rawData: true }
            });

            const customerOrderCounts = new Map<number, number>();
            for (const order of ordersWithCustomers) {
                const customerId = (order.rawData as any)?.customer_id;
                if (customerId && customerId > 0) {
                    customerOrderCounts.set(customerId, (customerOrderCounts.get(customerId) || 0) + 1);
                }
            }

            // Batch update customer order counts
            const updatePromises: Promise<any>[] = [];
            for (const [wooId, count] of customerOrderCounts) {
                updatePromises.push(
                    prisma.wooCustomer.updateMany({
                        where: { accountId, wooId },
                        data: { ordersCount: count }
                    })
                );
            }

            await Promise.allSettled(updatePromises);
            Logger.info(`Updated order counts for ${customerOrderCounts.size} customers`, { accountId, syncId });
        } catch (error: any) {
            Logger.warn('Failed to recalculate customer order counts', { accountId, syncId, error: error.message });
        }

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }
}

