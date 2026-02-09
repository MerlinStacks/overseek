import { QueueFactory, QUEUES } from '../services/queue/QueueFactory';
import { Logger } from '../utils/logger';
import { OrderSync } from '../services/sync/OrderSync';
import { ProductSync } from '../services/sync/ProductSync';
import { CustomerSync } from '../services/sync/CustomerSync';
import { ReviewSync } from '../services/sync/ReviewSync';
import { EventBus, EVENTS } from '../services/events';

export async function startWorkers() {
    Logger.info('Starting Workers...');


    QueueFactory.createWorker(QUEUES.ORDERS, async (job) => {
        const syncer = new OrderSync();
        await syncer.perform(job.data, job);
    });


    QueueFactory.createWorker(QUEUES.PRODUCTS, async (job) => {
        const syncer = new ProductSync();
        await syncer.perform(job.data, job);
    });


    QueueFactory.createWorker(QUEUES.CUSTOMERS, async (job) => {
        const syncer = new CustomerSync();
        await syncer.perform(job.data, job);
    });


    QueueFactory.createWorker(QUEUES.REVIEWS, async (job) => {
        const syncer = new ReviewSync();
        await syncer.perform(job.data, job);
    });


    await import('../services/analytics/ReportWorker').then(({ ReportWorker }) => {
        QueueFactory.createWorker(QUEUES.REPORTS, async (job) => {
            await ReportWorker.process(job);
        });
    });


    try {
        const { BOMInventorySyncService } = await import('../services/BOMInventorySyncService');
        QueueFactory.createWorker(QUEUES.BOM_SYNC, async (job) => {
            const { accountId } = job.data;
            const result = await BOMInventorySyncService.syncAllBOMProducts(accountId);
            Logger.info(`[BOM Worker] Completed BOM sync`, {
                accountId,
                synced: result.synced,
                skipped: result.skipped,
                failed: result.failed
            });
        });
        Logger.info('[Workers] BOM Inventory Sync worker registered');
    } catch (err: any) {
        Logger.error('[Workers] FAILED to register BOM Inventory Sync worker', { error: err.message, stack: err.stack });
    }

    // consume BOM components when orders hit 'processing' status
    await import('../services/BOMConsumptionService').then(({ BOMConsumptionService }) => {
        EventBus.on(EVENTS.ORDER.SYNCED, async ({ accountId, order }) => {
            try {
                const status = (order?.status || '').toLowerCase();
                if (status === 'processing') {
                    Logger.info(`[BOMConsumption] Triggering consumption for order ${order.id} (status: processing)`, { accountId });
                    await BOMConsumptionService.consumeOrderComponents(accountId, order);
                }
            } catch (err: any) {
                Logger.error('[BOMConsumption] Failed to consume components', {
                    accountId,
                    orderId: order?.id,
                    error: err.message
                });
            }
        });

        Logger.info('[Workers] BOM Consumption event listener registered');
    });

    // Graceful Shutdown
    process.on('SIGTERM', async () => {
        Logger.info('SIGTERM received. Closing workers...');
        // TODO: properly track and close workers instead of relying on process exit
        await import('../utils/redis').then(r => r.redisClient.quit());
        process.exit(0);
    });
}
