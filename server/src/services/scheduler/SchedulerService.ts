/**
 * Scheduler Service - Orchestrator
 * 
 * Lightweight orchestrator that coordinates all specialized schedulers.
 * Responsibility: Start/stop scheduling subsystems and route worker jobs.
 * 
 * Refactored from 847-line monolith -> ~80-line orchestrator.
 */
import { QueueFactory } from '../queue/QueueFactory';
import { Logger } from '../../utils/logger';
import { SyncScheduler } from './SyncScheduler';
import { MessageScheduler } from './MessageScheduler';
import { MarketingScheduler } from './MarketingScheduler';
import { MaintenanceScheduler } from './MaintenanceScheduler';
import { ShippingTrackingScheduler } from './ShippingTrackingScheduler';

export class SchedulerService {
    private static readonly DEPRECATED_JOB_NAMES = new Set([
        'execute-pending-actions',
        'audience-refresh'
    ]);

    /**
     * Start all scheduled tasks
     */
    static async start() {
        Logger.info('Starting Scheduler Service...');

        // Register all BullMQ repeatable jobs
        await SyncScheduler.register();
        await MarketingScheduler.register();
        await MaintenanceScheduler.register();
        await ShippingTrackingScheduler.register();

        // Remove stale repeatable jobs from older deployments.
        await this.cleanupDeprecatedJobs();

        // Start all setInterval tickers
        this.startTickers();

        // Register the unified worker to route jobs to appropriate handlers
        this.registerWorker();
    }

    /**
     * Remove repeatable jobs that no longer exist in the current scheduler.
     */
    private static async cleanupDeprecatedJobs() {
        try {
            const queue = QueueFactory.createQueue('scheduler');
            const repeatableJobs = await queue.getRepeatableJobs();
            let removed = 0;

            for (const job of repeatableJobs) {
                if (!this.DEPRECATED_JOB_NAMES.has(job.name)) continue;

                await queue.removeRepeatableByKey(job.key);
                removed++;
            }

            if (removed > 0) {
                Logger.info(`[Scheduler] Removed ${removed} deprecated repeatable job(s)`);
            }
        } catch (error) {
            Logger.warn('[Scheduler] Failed to cleanup deprecated repeatable jobs', { error });
        }
    }

    /**
     * Start all interval-based tickers
     */
    private static startTickers() {
        Logger.info('Starting Automation Tickers...');

        MessageScheduler.start();
        MarketingScheduler.start();
        MaintenanceScheduler.start();
    }

    /**
     * Register the central worker that routes jobs to specialized schedulers
     */
    private static schedulerWorker: import('bullmq').Worker | null = null;

    private static registerWorker() {
        this.schedulerWorker = QueueFactory.createWorker('scheduler', async (job) => {
            switch (job.name) {
                // Sync jobs
                case 'orchestrate-sync':
                    await SyncScheduler.dispatchToAllAccounts();
                    break;
                case 'fast-order-sync':
                    await SyncScheduler.dispatchFastOrderSync();
                    break;

                // Maintenance jobs
                case 'inventory-alerts':
                    await MaintenanceScheduler.dispatchInventoryAlerts();
                    break;
                case 'gold-price-update':
                    await MaintenanceScheduler.dispatchGoldPriceUpdates();
                    break;
                case 'bom-inventory-sync':
                    await MaintenanceScheduler.dispatchBOMInventorySync();
                    break;
                case 'account-backups':
                    await MaintenanceScheduler.dispatchScheduledBackups();
                    break;
                case 'meta-token-refresh':
                    await MaintenanceScheduler.dispatchMetaTokenRefresh();
                    break;
                case 'bom-deduction-recovery':
                    await MaintenanceScheduler.dispatchBOMDeductionRecovery();
                    break;
                case 'queue-depth-check':
                    await MaintenanceScheduler.dispatchQueueDepthCheck();
                    break;
                case 'conversion-retry':
                    await MaintenanceScheduler.dispatchConversionRetry();
                    break;
                case 'shipping-tracking-poll':
                    await ShippingTrackingScheduler.dispatchTrackingPoll();
                    break;
                case 'shipping-label-storage-cleanup':
                    await ShippingTrackingScheduler.dispatchLabelStorageCleanup();
                    break;

                // Marketing jobs
                case 'outcome-assessment':
                    await MarketingScheduler.dispatchOutcomeAssessment();
                    break;
                case 'ad-alerts':
                    await MarketingScheduler.dispatchAdAlerts();
                    break;
                case 'weekly-digest':
                    await MarketingScheduler.dispatchWeeklyDigests();
                    break;
                case 'ai-manager-suggestions':
                    await MarketingScheduler.dispatchAiManagerSuggestions();
                    break;

                // Why: stale repeatable job from a previous deployment persists
                // in Redis. No-op until the job is properly removed or re-implemented.
                case 'audience-refresh':
                    Logger.debug('[Scheduler] audience-refresh is deprecated, skipping');
                    break;

                // Why: stale repeatable job from a previous deployment persists
                // in Redis. No-op until the job is removed.
                case 'execute-pending-actions':
                    Logger.debug('[Scheduler] execute-pending-actions is deprecated, skipping');
                    break;

                default:
                    Logger.warn(`[Scheduler] Unknown job type: ${job.name}`);
            }
        });

        Logger.info('Scheduler worker registered');
    }

    /**
     * Gracefully close the scheduler worker on shutdown.
     */
    static async shutdown() {
        // Stop interval tickers first so no new work is enqueued during shutdown.
        MessageScheduler.stop();
        MarketingScheduler.stop();
        MaintenanceScheduler.stop();

        if (this.schedulerWorker) {
            await this.schedulerWorker.close();
            this.schedulerWorker = null;
            Logger.info('Scheduler worker closed');
        }
    }
}
