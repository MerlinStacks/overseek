import { BaseSync } from './BaseSync';
import { WooService } from '../woo';
import { PrismaClient } from '@prisma/client';
import { IndexingService } from '../search/IndexingService';
import { OrderTaggingService } from '../OrderTaggingService';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';

const prisma = new PrismaClient();

export class OrderSync extends BaseSync {
    protected entityType = 'orders';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any): Promise<void> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;

        while (hasMore) {
            const { data: orders, totalPages } = await woo.getOrders({ page, after, per_page: 50 });
            if (!orders.length) {
                hasMore = false;
                break;
            }

            for (const order of orders) {
                const existing = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: order.id } }
                });

                await prisma.wooOrder.upsert({
                    where: { accountId_wooId: { accountId, wooId: order.id } },
                    update: {
                        status: order.status,
                        total: order.total === '' ? '0' : order.total,
                        currency: order.currency,
                        dateModified: new Date(order.date_modified || new Date()),
                        rawData: order as any
                    },
                    create: {
                        accountId,
                        wooId: order.id,
                        number: order.number,
                        status: order.status,
                        total: order.total === '' ? '0' : order.total,
                        currency: order.currency,
                        dateCreated: new Date(order.date_created || new Date()),
                        dateModified: new Date(order.date_modified || new Date()),
                        rawData: order as any
                    }
                });

                // Detect Changes for Automation
                const isNew = !existing;
                const isStatusChanged = existing && existing.status !== order.status;

                // 1. Order Created (Recent check needed to avoid spamming on full sync?)
                // If it's new, it's created. We can trust isNew.
                // But if we sync old orders, we don't want to trigger "New Order" emails.
                // So check date_created.
                const orderDate = new Date(order.date_created);
                const isRecent = (new Date().getTime() - orderDate.getTime()) < 24 * 60 * 60 * 1000;

                if (isNew && isRecent) {
                    EventBus.emit(EVENTS.ORDER.CREATED, { accountId, order });
                }

                // 2. Order Completed
                if (order.status === 'completed' && (isNew || isStatusChanged)) {
                    // We define a new event or reuse?
                    // Let's add ORDER.COMPLETED to events potentially, or just use SYNCED with metadata?
                    // Better to emit specific event.
                    // For now, let's emit a generic Status Changed event or assume Listener filters?
                    // Let's add COMPLETED to EVENTS in a separate step or just emit 'order:completed' string.
                    EventBus.emit('order:completed', { accountId, order });
                }

                // Generic Synced Event
                EventBus.emit(EVENTS.ORDER.SYNCED, { accountId, order });

                // Index into Elasticsearch (with tags)
                try {
                    const tags = await OrderTaggingService.extractTagsFromOrder(accountId, order);
                    await IndexingService.indexOrder(accountId, order, tags);
                } catch (error: any) {
                    Logger.warn(`Failed to index order ${order.id}`, { accountId, error: error.message });
                }

                totalProcessed++;
            }

            Logger.info(`Synced batch of ${orders.length} orders`, { accountId, page, totalPages });
            if (orders.length < 50) hasMore = false;

            // Progress Update
            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);

                // Cancellation Check
                const isActive = await job.isActive();
                if (!isActive) {
                    throw new Error('Cancelled');
                }
            }

            page++;
        }

        Logger.info(`Order Sync Complete. Total: ${totalProcessed}`, { accountId });
    }
}
