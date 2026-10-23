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
    PAGES: 'sync-pages',
    BLOG_POSTS: 'sync-blog-posts',
    REPORTS: 'report-generation',
    BOM_SYNC: 'bom-inventory-sync',
    AUTOMATIONS: 'automation-execution',
    CAMPAIGNS: 'campaign-send',
    FEED_OPTIMIZE: 'feed-optimize',
    INVOICE_CANONICAL_GENERATE: 'invoice-canonical-generate',
    WHOLESALE_CATALOG_GENERATE: 'wholesale-catalog-generate',
    WHOLESALE_CATALOG_SHARE_PREPARE: 'wholesale-catalog-share-prepare',
    WHOLESALE_CATALOG_VALIDITY_UPDATE: 'wholesale-catalog-validity-update',
};

// Global Store for Queues to adapter
const queues = new Map<string, Queue>();
const workers = new Set<Worker>();

/** Only read/sync work is automatically retried. Side effects and unknown queues
 * retain evidence and require occurrence-aware reconciliation after failure. */
export function queueWorkPolicy(name: string) {
    const replayable = [QUEUES.ORDERS, QUEUES.PRODUCTS, QUEUES.REVIEWS, QUEUES.CUSTOMERS, QUEUES.PAGES, QUEUES.BLOG_POSTS].includes(name);
    return { replayable, attempts: replayable ? QUEUE_LIMITS.MAX_RETRIES : 1, removeOnComplete: replayable ? { count: QUEUE_LIMITS.COMPLETED_JOBS_KEEP } : false as const, removeOnFail: false as const };
}

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
                ...queueWorkPolicy(name),
                backoff: {
                    type: 'exponential',
                    delay: QUEUE_LIMITS.RETRY_DELAY_MS,
                },
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
     * Non-destructive backpressure check. It is an observation, not atomic
     * reservation: producers still need stable job identities and scoped budgets.
     */
    static async enforceMaxQueueDepth(name: string): Promise<number> {
        const queue = this.getQueue(name);
        const counts = await queue.getJobCounts('waiting', 'prioritized');
        const waitingCount = (counts.waiting || 0) + (counts.prioritized || 0);

        if (waitingCount <= QUEUE_LIMITS.MAX_QUEUE_DEPTH) {
            return 0;
        }

        throw Object.assign(new Error('Queue admission deferred: reconcile backlog; existing jobs retained'), { code: 'QUEUE_BACKPRESSURE', queueName: name });
    }

    static createWorker(name: string, processor: (job: any) => Promise<void>) {
        const workerStartedAt = Date.now();
        type Run = { processedOn: number | null; accountId?: string; startedAt: number; lastLockRenewedAt: number | null; lockRenewalFailures: number };
        const runs = new Map<string, Run>();
        const currentRun = (job: { id?: string; processedOn?: number } | undefined) => {
            const run = job?.id ? runs.get(job.id) : undefined;
            return run && run.processedOn === (job?.processedOn ?? null) ? run : undefined;
        };
        // Long-running jobs need extended lock durations to prevent false stall detection.
        // Why: A full order sync (32k+ orders) takes 5-10min. With the default 30s lock,
        // BullMQ kills the job thinking it's stalled, causing incomplete syncs.
        const isLongRunning = [
            QUEUES.ORDERS, QUEUES.PRODUCTS, QUEUES.CUSTOMERS, QUEUES.REVIEWS,
            QUEUES.PAGES, QUEUES.BLOG_POSTS,
            QUEUES.BOM_SYNC, QUEUES.REPORTS, QUEUES.CAMPAIGNS, QUEUES.WHOLESALE_CATALOG_GENERATE,
            QUEUES.WHOLESALE_CATALOG_SHARE_PREPARE, QUEUES.WHOLESALE_CATALOG_VALIDITY_UPDATE
        ].includes(name);

        const worker = new Worker(name, async (job) => {
            if (job.id) runs.set(job.id, { processedOn: job.processedOn ?? null, accountId: job.data.accountId, startedAt: Date.now(), lastLockRenewedAt: null, lockRenewalFailures: 0 });
            // Store only bounded scalar diagnostics, never retained job payloads/tokens.
            while (runs.size > QUEUE_LIMITS.COMPLETED_JOBS_KEEP) runs.delete(runs.keys().next().value!);
            Logger.info(`Processing Job ${job.id}`, { jobId: job.id, accountId: job.data.accountId });
            await processor(job);
        }, {
            connection: createWorkerConnection() as any,
            concurrency: QUEUE_LIMITS.WORKER_CONCURRENCY,
            maxStalledCount: queueWorkPolicy(name).replayable ? 1 : 0,
            lockDuration: isLongRunning
                ? QUEUE_LIMITS.LONG_RUNNING_LOCK_DURATION_MS
                : QUEUE_LIMITS.DEFAULT_LOCK_DURATION_MS,
            stalledInterval: isLongRunning
                ? QUEUE_LIMITS.LONG_RUNNING_STALL_INTERVAL_MS
                : QUEUE_LIMITS.DEFAULT_LOCK_DURATION_MS,
        });

        worker.on('completed', (job) => {
            if (currentRun(job)) runs.delete(job.id!);
            Logger.info(`Job ${job.id} Completed`);
        });

        worker.on('failed', (job, err) => {
            const run = currentRun(job);
            Logger.error(`Job ${job?.id} Failed`, {
                error: err.message, queueName: name, jobId: job?.id, accountId: job?.data?.accountId,
                ...(name === QUEUES.BOM_SYNC && err.message.includes('stalled') ? {
                    code: 'BOM_SYNC_RECONCILIATION_REQUIRED', progress: job?.progress,
                    processId: process.pid, workerStartedAt, jobProcessedOn: job?.processedOn ?? null,
                    executionOrigin: run ? 'this-worker' : job?.processedOn && job.processedOn < workerStartedAt ? 'pre-existing-or-other-worker' : 'not-observed-by-this-worker',
                    processorStartedAt: run?.startedAt ?? null, lastLockRenewedAt: run?.lastLockRenewedAt ?? null,
                    lockRenewalFailures: run?.lockRenewalFailures ?? null,
                    recovery: 'Worker lock was lost. Use execution origin, processing time and lock-renewal evidence to distinguish inherited work from a live worker failure. Review acknowledged Woo stock writes before a new sync; do not blindly retry or remove this job.',
                } : {}),
            });
            if (run && job?.id) runs.delete(job.id);
        });

        worker.on('locksRenewed', ({ jobIds }) => {
            for (const jobId of jobIds) { const run = runs.get(jobId); if (run) run.lastLockRenewedAt = Date.now(); }
        });
        worker.on('lockRenewalFailed', jobIds => {
            for (const jobId of jobIds) {
                const run = runs.get(jobId);
                if (run) run.lockRenewalFailures++;
                Logger.error('[QueueFactory] Job lock renewal failed', { queueName: name, jobId, processId: process.pid, accountId: run?.accountId,
                    workerStartedAt, processorStartedAt: run?.startedAt ?? null, lastLockRenewedAt: run?.lastLockRenewedAt ?? null,
                    lockRenewalFailures: run?.lockRenewalFailures ?? null });
            }
        });

        worker.on('error', (err) => {
            Logger.error(`[QueueFactory] Worker error on queue "${name}"`, { error: err.message });
        });

        workers.add(worker);
        worker.on('closed', () => { runs.clear(); workers.delete(worker); });

        return worker;
    }

    static async closeWorkers(): Promise<void> {
        if (workers.size === 0) return;
        const closing = Array.from(workers);
        await Promise.allSettled(closing.map(worker => worker.close()));
        closing.forEach(worker => workers.delete(worker));
    }

    static async closeQueues(): Promise<void> {
        if (queues.size === 0) return;
        const closing = Array.from(queues.values());
        await Promise.allSettled(closing.map(queue => queue.close()));
        queues.clear();
    }

    /**
     * Returns queue depth health data for operational monitoring.
     */
    static async getQueueDepthSnapshot() {
        const queueNames = [...new Set([
            ...Object.values(QUEUES),
            'scheduler',
            ...Array.from(queues.keys())
        ])];

        const entries = await Promise.all(queueNames.map(async (name) => {
            const queue = this.getQueue(name);
            const counts = await queue.getJobCounts(
                'waiting',
                'active',
                'delayed',
                'failed',
                'completed',
                'paused',
                'prioritized'
            );

            const waiting = counts.waiting || 0;
            const active = counts.active || 0;
            const delayed = counts.delayed || 0;
            const paused = counts.paused || 0;
            const prioritized = counts.prioritized || 0;

            return [name, {
                waiting,
                active,
                delayed,
                failed: counts.failed || 0,
                completed: counts.completed || 0,
                paused,
                prioritized,
                backlog: waiting + active + delayed + paused + prioritized
            }] as const;
        }));

        return Object.fromEntries(entries);
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
