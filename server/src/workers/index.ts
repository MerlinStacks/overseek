import { QueueFactory, QUEUES } from '../services/queue/QueueFactory';
import { Logger } from '../utils/logger';
import { OrderSync } from '../services/sync/OrderSync';
import { ProductSync } from '../services/sync/ProductSync';
import { CustomerSync } from '../services/sync/CustomerSync';
import { ReviewSync } from '../services/sync/ReviewSync';
import { EventBus, EVENTS } from '../services/events';
import { Worker } from 'bullmq';

/** Track all workers for graceful shutdown */
const activeWorkers: Worker[] = [];

export async function startWorkers() {
    Logger.info('Starting Workers...');


    activeWorkers.push(QueueFactory.createWorker(QUEUES.ORDERS, async (job) => {
        const syncer = new OrderSync();
        await syncer.perform(job.data, job);
    }));


    activeWorkers.push(QueueFactory.createWorker(QUEUES.PRODUCTS, async (job) => {
        const syncer = new ProductSync();
        await syncer.perform(job.data, job);
    }));


    activeWorkers.push(QueueFactory.createWorker(QUEUES.CUSTOMERS, async (job) => {
        const syncer = new CustomerSync();
        await syncer.perform(job.data, job);
    }));


    activeWorkers.push(QueueFactory.createWorker(QUEUES.REVIEWS, async (job) => {
        const syncer = new ReviewSync();
        await syncer.perform(job.data, job);
    }));


    await import('../services/analytics/ReportWorker').then(({ ReportWorker }) => {
        activeWorkers.push(QueueFactory.createWorker(QUEUES.REPORTS, async (job) => {
            await ReportWorker.process(job);
        }));
    });


    try {
        const { BOMInventorySyncService } = await import('../services/BOMInventorySyncService');
        activeWorkers.push(QueueFactory.createWorker(QUEUES.BOM_SYNC, async (job) => {
            const { accountId } = job.data;
            const result = await BOMInventorySyncService.syncAllBOMProducts(accountId);
            Logger.info(`[BOM Worker] Completed BOM sync`, {
                accountId,
                synced: result.synced,
                skipped: result.skipped,
                failed: result.failed
            });
        }));
        Logger.info('[Workers] BOM Inventory Sync worker registered');
    } catch (err: any) {
        Logger.error('[Workers] FAILED to register BOM Inventory Sync worker', { error: err.message, stack: err.stack });
    }

    // Handle BOM consumption/reversal based on order lifecycle status changes
    await import('../services/BOMConsumptionService').then(({ BOMConsumptionService }) => {
        EventBus.on(EVENTS.ORDER.SYNCED, async ({ accountId, order }) => {
            try {
                const status = (order?.status || '').toLowerCase();

                if (status === 'processing' || status === 'completed') {
                    // Consume BOM components (dedup prevents double-consumption)
                    Logger.info(`[BOMConsumption] Triggering consumption for order ${order.id} (status: ${status})`, { accountId });
                    await BOMConsumptionService.consumeOrderComponents(accountId, order);
                } else if (status === 'cancelled' || status === 'refunded' || status === 'failed') {
                    // Reverse prior consumption if order was cancelled/refunded
                    Logger.info(`[BOMConsumption] Triggering reversal for order ${order.id} (status: ${status})`, { accountId });
                    await BOMConsumptionService.reverseOrderConsumption(accountId, order);
                }
            } catch (err: any) {
                Logger.error('[BOMConsumption] Failed to process order event', {
                    accountId,
                    orderId: order?.id,
                    status: order?.status,
                    error: err.message
                });
            }
        });

        Logger.info('[Workers] BOM Consumption event listener registered');
    });

    // Graceful Shutdown — close workers before disconnecting Redis
    process.on('SIGTERM', async () => {
        Logger.info(`SIGTERM received. Closing ${activeWorkers.length} workers...`);
        await Promise.allSettled(
            activeWorkers.map(w => w.close())
        );
        Logger.info('All workers closed');
        await import('../utils/redis').then(r => r.redisClient.quit());
        process.exit(0);
    });
}
