import { QueueFactory, QUEUES } from './queue/QueueFactory';
import { SyncJobData } from './queue/SyncQueue';
import { Logger } from '../utils/logger';

export class SyncService {

    /**
     * Trigger a sync for an account.
     * This now dispatches jobs to the Queue system.
     */
    async runSync(accountId: string, options: { types?: string[], incremental?: boolean, priority?: number, triggerSource?: 'SYSTEM' | 'MANUAL' | 'RETRY' } = {}) {
        const types = options.types || ['orders', 'products', 'customers', 'reviews'];
        const incremental = options.incremental !== false; // Default true
        const priority = options.priority || 10;
        const triggerSource = options.triggerSource || 'SYSTEM';

        Logger.info(`Dispatching Sync Jobs for Account ${accountId}`, { types, incremental });

        const jobs: Promise<any>[] = [];

        const checkAndAddJob = async (queueName: string, jobData: SyncJobData, jobIdBase: string) => {
            const queue = QueueFactory.createQueue(queueName);
            // Use consistent ID without timestamp to prevent duplicates (Sync Deduplication)
            const stableJobId = jobIdBase;

            const existingJob = await queue.getJob(stableJobId);

            if (existingJob) {
                const state = await existingJob.getState();
                // If active, waiting, or delayed - we skip to prevent concurrency
                if (['active', 'waiting', 'delayed'].includes(state)) {
                    Logger.info(`Skipping ${queueName} for ${accountId} - Job ${existingJob.id} is ${state}`);
                    return;
                }

                // If completed/failed/unknown, we try to remove it to allow re-run
                try {
                    await existingJob.remove();
                } catch (err: any) {
                    // Race condition: job became active between state check and removal
                    // This is expected behavior - just skip as we would for active jobs
                    if (err?.message?.includes('locked by another worker')) {
                        Logger.info(`Skipping ${queueName} for ${accountId} - Job ${stableJobId} became active`);
                        return;
                    }
                    // Any other removal error should also skip to prevent duplicate job creation
                    Logger.warn(`Failed to remove existing job ${stableJobId}, skipping`, { error: err });
                    return;
                }
            }

            jobs.push(queue.add(queueName, jobData, {
                jobId: stableJobId,
                priority,
                removeOnComplete: true, // Ensure it clears after success to allow next run
                removeOnFail: 100 // Keep failed for debugging
            }));
        };

        if (types.includes('orders')) {
            await checkAndAddJob(QUEUES.ORDERS, { accountId, incremental, triggerSource } as SyncJobData, `sync_orders_${accountId.replace(/:/g, '_')}`);
        }

        if (types.includes('products')) {
            await checkAndAddJob(QUEUES.PRODUCTS, { accountId, incremental, triggerSource } as SyncJobData, `sync_products_${accountId.replace(/:/g, '_')}`);
        }

        if (types.includes('customers')) {
            await checkAndAddJob(QUEUES.CUSTOMERS, { accountId, incremental, triggerSource } as SyncJobData, `sync_customers_${accountId.replace(/:/g, '_')}`);
        }

        if (types.includes('reviews')) {
            await checkAndAddJob(QUEUES.REVIEWS, { accountId, incremental, triggerSource } as SyncJobData, `sync_reviews_${accountId.replace(/:/g, '_')}`);
        }

        await Promise.all(jobs);
        Logger.info(`Dispatched ${jobs.length} jobs to queues`);
    }

    /* 
     * Static helper for specific access if needed, 
     * but prefer runSync facade 
     */
}
