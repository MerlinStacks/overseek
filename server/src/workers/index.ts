import { QueueFactory, QUEUES } from '../services/queue/QueueFactory';
import { Logger } from '../utils/logger';
import { OrderSync } from '../services/sync/OrderSync';
import { ProductSync } from '../services/sync/ProductSync';
import { CustomerSync } from '../services/sync/CustomerSync';
import { ReviewSync } from '../services/sync/ReviewSync';

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
