import { Queue, Worker } from 'bullmq';
import { redisClient, createWorkerConnection } from '../../utils/redis';
import { Logger } from '../../utils/logger';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { QUEUE_LIMITS } from '../../config/limits';

// Define Queue Names
export const QUEUES = {
    ORDERS: 'sync-orders',
    PRODUCTS: 'sync-products',
    REVIEWS: 'sync-reviews',
    CUSTOMERS: 'sync-customers',
    REPORTS: 'report-generation',
    BOM_SYNC: 'bom-inventory-sync',
};

// Global Store for Queues to adapter
const queues = new Map<string, Queue>();

export class QueueFactory {

    static init() {
        // Initialize all known queues to ensure they appear in Bull Board
        Object.values(QUEUES).forEach(name => this.getQueue(name));
        this.getQueue('scheduler');
    }

    static getQueue(name: string) {
        if (queues.has(name)) {
            return queues.get(name)!;
        }

        const queue = new Queue(name, {
            connection: redisClient as any,
            defaultJobOptions: {
                attempts: QUEUE_LIMITS.MAX_RETRIES,
                backoff: {
                    type: 'exponential',
                    delay: QUEUE_LIMITS.RETRY_DELAY_MS,
                },
                removeOnComplete: { count: QUEUE_LIMITS.COMPLETED_JOBS_KEEP },
                removeOnFail: { age: QUEUE_LIMITS.FAILED_JOBS_TTL_SECONDS },
            },
        });

        queues.set(name, queue);
        return queue;
    }

    // Alias for compatibility
    static createQueue(name: string) {
        return this.getQueue(name);
    }

    /**
     * EDGE CASE FIX: Enforce max queue depth to prevent OOM on Redis reconnect.
     * When the queue has more waiting jobs than MAX_QUEUE_DEPTH, removes oldest jobs.
     * Should be called periodically or before adding new jobs.
     */
    static async enforceMaxQueueDepth(name: string): Promise<number> {
        const queue = this.getQueue(name);
        const waitingCount = await queue.getWaitingCount();

        if (waitingCount <= QUEUE_LIMITS.MAX_QUEUE_DEPTH) {
            return 0;
        }

        const excessCount = waitingCount - QUEUE_LIMITS.MAX_QUEUE_DEPTH;
        const waitingJobs = await queue.getWaiting(0, excessCount);

        let removed = 0;
        for (const job of waitingJobs) {
            try {
                await job.remove();
                removed++;
            } catch {
                // Job may have started processing, skip
            }
        }

        if (removed > 0) {
            Logger.warn(`[QueueFactory] Trimmed ${removed} oldest jobs from ${name} queue (was ${waitingCount}, max ${QUEUE_LIMITS.MAX_QUEUE_DEPTH})`, {
                queueName: name,
                removed,
                previousCount: waitingCount,
                maxDepth: QUEUE_LIMITS.MAX_QUEUE_DEPTH
            });
        }

        return removed;
    }

    static createWorker(name: string, processor: (job: any) => Promise<void>) {
        // Long-running jobs need extended lock durations to prevent false stall detection.
        // Why: A full order sync (32k+ orders) takes 5-10min. With the default 30s lock,
        // BullMQ kills the job thinking it's stalled, causing incomplete syncs.
        const isLongRunning = [
            QUEUES.ORDERS, QUEUES.PRODUCTS, QUEUES.CUSTOMERS, QUEUES.REVIEWS,
            QUEUES.BOM_SYNC, QUEUES.REPORTS
        ].includes(name);

        const worker = new Worker(name, async (job) => {
            Logger.info(`Processing Job ${job.id}`, { jobId: job.id, accountId: job.data.accountId });
            await processor(job);
        }, {
            connection: createWorkerConnection() as any,
            concurrency: QUEUE_LIMITS.WORKER_CONCURRENCY,
            lockDuration: isLongRunning
                ? QUEUE_LIMITS.LONG_RUNNING_LOCK_DURATION_MS
                : QUEUE_LIMITS.DEFAULT_LOCK_DURATION_MS,
            stalledInterval: isLongRunning
                ? QUEUE_LIMITS.LONG_RUNNING_STALL_INTERVAL_MS
                : QUEUE_LIMITS.DEFAULT_LOCK_DURATION_MS,
        });

        worker.on('completed', (job) => {
            Logger.info(`Job ${job.id} Completed`);
        });

        worker.on('failed', (job, err) => {
            Logger.error(`Job ${job?.id} Failed`, { error: err.message });
        });

        return worker;
    }

    // Bull Board Setup
    static createBoard() {
        const serverAdapter = new FastifyAdapter();
        serverAdapter.setBasePath('/admin/queues');

        createBullBoard({
            queues: Array.from(queues.values()).map(q => new BullMQAdapter(q)) as any,
            serverAdapter: serverAdapter as any,
        });

        return serverAdapter;
    }
}
