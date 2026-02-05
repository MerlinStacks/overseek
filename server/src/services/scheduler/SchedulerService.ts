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

export class SchedulerService {
    /**
     * Start all scheduled tasks
     */
    static async start() {
        Logger.info('Starting Scheduler Service...');

        // Register all BullMQ repeatable jobs
        await SyncScheduler.register();
        await MarketingScheduler.register();
        await MaintenanceScheduler.register();

        // Start all setInterval tickers
        this.startTickers();

        // Register the unified worker to route jobs to appropriate handlers
        this.registerWorker();
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
    private static registerWorker() {
        QueueFactory.createWorker('scheduler', async (job) => {
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
                case 'audience-refresh':
                    await MarketingScheduler.dispatchAudienceRefresh();
                    break;
                case 'budget-rebalancer':
                    await MarketingScheduler.dispatchBudgetRebalancer();
                    break;
                case 'execute-pending-actions':
                    await MarketingScheduler.dispatchPendingActions();
                    break;
                case 'experiment-metrics-refresh':
                    await MarketingScheduler.dispatchExperimentMetricsRefresh();
                    break;
                case 'experiment-significance-check':
                    await MarketingScheduler.dispatchExperimentSignificanceCheck();
                    break;

                default:
                    Logger.warn(`[Scheduler] Unknown job type: ${job.name}`);
            }
        });

        Logger.info('Scheduler worker registered');
    }
}
