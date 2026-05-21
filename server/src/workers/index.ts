import { QueueFactory, QUEUES } from '../services/queue/QueueFactory';
import { Logger } from '../utils/logger';
import { OrderSync } from '../services/sync/OrderSync';
import { ProductSync } from '../services/sync/ProductSync';
import { CustomerSync } from '../services/sync/CustomerSync';
import { ReviewSync } from '../services/sync/ReviewSync';
import { PageSync } from '../services/sync/PageSync';
import { BlogPostSync } from '../services/sync/BlogPostSync';
import { EventBus, EVENTS } from '../services/events';
import { Worker } from 'bullmq';
import { automationEngine } from '../services/AutomationEngine';
import { MarketingService } from '../services/MarketingService';
import { normalizeOrderStatus } from '../constants/orderStatus';
import { FeedMappingService } from '../services/feedMapping';
import { canonicalInvoiceService } from '../services/CanonicalInvoiceService';

/** Track all workers for graceful shutdown */
const activeWorkers: Worker[] = [];
const marketingService = new MarketingService();

export async function stopWorkers() {
    if (activeWorkers.length === 0) return;

    Logger.info(`Closing ${activeWorkers.length} workers...`);
    await QueueFactory.closeWorkers();
    activeWorkers.length = 0;
    Logger.info('All workers closed');
}

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

    activeWorkers.push(QueueFactory.createWorker(QUEUES.PAGES, async (job) => {
        const syncer = new PageSync();
        await syncer.perform(job.data, job);
    }));

    activeWorkers.push(QueueFactory.createWorker(QUEUES.BLOG_POSTS, async (job) => {
        const syncer = new BlogPostSync();
        await syncer.perform(job.data, job);
    }));


    await import('../services/analytics/ReportWorker').then(({ ReportWorker }) => {
        activeWorkers.push(QueueFactory.createWorker(QUEUES.REPORTS, async (job) => {
            await ReportWorker.process(job);
        }));
    });

    activeWorkers.push(QueueFactory.createWorker(QUEUES.AUTOMATIONS, async (job) => {
        const { enrollmentId } = job.data as { enrollmentId?: string };
        if (!enrollmentId) {
            Logger.warn('[Automation Worker] Missing enrollmentId in job payload', {
                jobId: job.id
            });
            return;
        }

        await automationEngine.processEnrollment(enrollmentId);
    }));

    activeWorkers.push(QueueFactory.createWorker(QUEUES.CAMPAIGNS, async (job) => {
        const { campaignId, accountId } = job.data as { campaignId?: string; accountId?: string };
        if (!campaignId || !accountId) {
            Logger.warn('[Campaign Worker] Missing campaignId/accountId in job payload', { jobId: job.id });
            return;
        }

        await marketingService.sendCampaign(campaignId, accountId);
    }));

    activeWorkers.push(QueueFactory.createWorker(QUEUES.FEED_OPTIMIZE, async (job) => {
        const result = await FeedMappingService.processOptimizeBulkJob(job.data, job as any);
        return result as any;
    }));

    activeWorkers.push(QueueFactory.createWorker(QUEUES.INVOICE_CANONICAL_GENERATE, async (job) => {
        const { artifactId, accountId, orderId, templateId } = job.data as {
            artifactId?: string;
            accountId?: string;
            orderId?: string;
            templateId?: string;
        };

        if (!artifactId || !accountId || !orderId || !templateId) {
            Logger.warn('[Invoice Canonical Worker] Missing required job payload', { jobId: job.id });
            return;
        }

        await canonicalInvoiceService.processGenerationJob({ artifactId, accountId, orderId, templateId });
    }));


    try {
        const { BOMInventorySyncService } = await import('../services/BOMInventorySyncService');
        activeWorkers.push(QueueFactory.createWorker(QUEUES.BOM_SYNC, async (job) => {
            const { accountId } = job.data;
            const result = await BOMInventorySyncService.syncAllBOMProducts(accountId, job);
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
                const status = normalizeOrderStatus(order?.status);

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

}
