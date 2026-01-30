import { QueueFactory, QUEUES } from '../services/queue/QueueFactory';
import { Logger } from '../utils/logger';
import { OrderSync } from '../services/sync/OrderSync';
import { ProductSync } from '../services/sync/ProductSync';
import { CustomerSync } from '../services/sync/CustomerSync';
import { ReviewSync } from '../services/sync/ReviewSync';
import { EventBus, EVENTS } from '../services/events';

export async function startWorkers() {
    Logger.info('Starting Workers...');

    // Order Worker
    QueueFactory.createWorker(QUEUES.ORDERS, async (job) => {
        const syncer = new OrderSync();
        await syncer.perform(job.data, job);
    });

    // Product Worker
    QueueFactory.createWorker(QUEUES.PRODUCTS, async (job) => {
        const syncer = new ProductSync();
        await syncer.perform(job.data, job);
    });

    // Customer Worker
    QueueFactory.createWorker(QUEUES.CUSTOMERS, async (job) => {
        const syncer = new CustomerSync();
        await syncer.perform(job.data, job);
    });

    // Review Worker
    QueueFactory.createWorker(QUEUES.REVIEWS, async (job) => {
        const syncer = new ReviewSync();
        await syncer.perform(job.data, job);
    });

    // Report Worker
    await import('../services/analytics/ReportWorker').then(({ ReportWorker }) => {
        QueueFactory.createWorker(QUEUES.REPORTS, async (job) => {
            await ReportWorker.process(job);
        });
    });

    // BOM Inventory Sync Worker
    console.log('[DEBUG] About to register BOM Inventory Sync worker...');
    try {
        console.log('[DEBUG] Importing BOMInventorySyncService...');
        const { BOMInventorySyncService } = await import('../services/BOMInventorySyncService');
        console.log('[DEBUG] BOMInventorySyncService imported successfully, creating worker...');
        QueueFactory.createWorker(QUEUES.BOM_SYNC, async (job) => {
            try {
                const { accountId } = job.data;
                console.log(`[DEBUG] BOM Worker processing job for account ${accountId}`);
                console.log('[DEBUG] About to call syncAllBOMProducts...');
                const result = await BOMInventorySyncService.syncAllBOMProducts(accountId);
                console.log('[DEBUG] syncAllBOMProducts completed:', JSON.stringify(result));
                Logger.info(`[BOM Worker] Completed BOM sync`, {
                    accountId,
                    synced: result.synced,
                    skipped: result.skipped,
                    failed: result.failed
                });
            } catch (err: any) {
                console.error('[DEBUG] BOM sync job CRASHED:', err.message);
                console.error('[DEBUG] Stack:', err.stack);
                throw err; // Re-throw so BullMQ knows job failed
            }
        });
        console.log('[DEBUG] BOM Inventory Sync worker registered successfully!');
        Logger.info('[Workers] BOM Inventory Sync worker registered');
    } catch (err: any) {
        console.error('[DEBUG] FAILED to register BOM worker:', err.message);
        Logger.error('[Workers] FAILED to register BOM Inventory Sync worker', { error: err.message, stack: err.stack });
    }

    // BOM Consumption on Order Creation/Sync
    // When an order is synced, check if it's in 'processing' status and consume BOM components
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
        // QueueFactory doesn't expose list of workers yet for closeAll, 
        // but for now process exit will handle it via BullMQ's own handlers usually, 
        // or we should track them.
        // For v1, basic node process exit is 'ok' but we should close redis.
        await import('../utils/redis').then(r => r.redisClient.quit());
        process.exit(0);
    });
}
