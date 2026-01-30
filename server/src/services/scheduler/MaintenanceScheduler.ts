/**
 * Maintenance Scheduler
 * 
 * Handles all maintenance/operational scheduling:
 * - Inventory alerts (daily)
 * - Gold price updates (daily)
 * - BOM inventory sync (hourly)
 * - Account backups (hourly)
 * - Janitor cleanup (daily)
 */
import { QueueFactory, QUEUES } from '../queue/QueueFactory';
import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { JanitorService } from '../JanitorService';

export class MaintenanceScheduler {
    private static queue = QueueFactory.createQueue('scheduler');
    private static janitorInterval: NodeJS.Timeout | null = null;

    /**
     * Register all maintenance-related repeatable jobs
     */
    static async register() {
        // Inventory Alerts (Daily at 08:00 UTC)
        await this.queue.add('inventory-alerts', {}, {
            repeat: { pattern: '0 8 * * *' },
            jobId: 'inventory-alerts-daily'
        });

        // Gold Price Updates (Daily at 06:00 UTC)
        await this.queue.add('gold-price-update', {}, {
            repeat: { pattern: '0 6 * * *' },
            jobId: 'gold-price-update-daily'
        });
        Logger.info('Scheduled Gold Price Update (Daily at 6 AM UTC)');

        // BOM Inventory Sync (Hourly)
        await this.queue.add('bom-inventory-sync', {}, {
            repeat: { pattern: '0 * * * *' },
            jobId: 'bom-inventory-sync-hourly'
        });
        Logger.info('Scheduled BOM Inventory Sync (Hourly)');

        // Account Backups (Hourly at :30)
        await this.queue.add('account-backups', {}, {
            repeat: { pattern: '30 * * * *' },
            jobId: 'account-backups-hourly'
        });
        Logger.info('Scheduled Account Backups Check (Hourly at :30)');
    }

    /**
     * Start maintenance tickers
     */
    static start() {
        // Run janitor on startup then daily
        JanitorService.runCleanup().catch(e => Logger.error('Janitor Error', { error: e }));
        this.janitorInterval = setInterval(
            () => JanitorService.runCleanup().catch(e => Logger.error('Janitor Error', { error: e })),
            24 * 60 * 60 * 1000
        );
    }

    /**
     * Dispatch inventory alerts for all accounts
     */
    static async dispatchInventoryAlerts() {
        const accounts = await prisma.account.findMany({ select: { id: true } });
        const { InventoryService } = await import('../InventoryService');
        const { InventoryForecastService } = await import('../analytics/InventoryForecastService');
        const { EventBus, EVENTS } = await import('../events');

        Logger.info(`[Scheduler] Dispatching Inventory Alerts for ${accounts.length} accounts`);

        for (const acc of accounts) {
            try {
                await InventoryService.sendLowStockAlerts(acc.id);

                const alerts = await InventoryForecastService.getStockoutAlerts(acc.id, 14);

                if (alerts.critical.length > 0) {
                    EventBus.emit(EVENTS.INVENTORY.STOCKOUT_ALERT, {
                        accountId: acc.id,
                        products: alerts.critical.map(p => ({
                            id: p.id,
                            name: p.name,
                            sku: p.sku,
                            currentStock: p.currentStock,
                            daysUntilStockout: p.daysUntilStockout,
                            stockoutRisk: p.stockoutRisk,
                            recommendedReorderQty: p.recommendedReorderQty
                        }))
                    });
                    Logger.info(`[Scheduler] Emitted stockout alert for ${alerts.critical.length} products`, { accountId: acc.id });
                }
            } catch (error) {
                Logger.error(`[Scheduler] Inventory alerts failed for account ${acc.id}`, { error });
            }
        }
    }

    /**
     * Update gold prices for accounts with the feature enabled
     */
    static async dispatchGoldPriceUpdates() {
        const { GoldPriceService } = await import('../GoldPriceService');

        const enabledAccounts = await prisma.accountFeature.findMany({
            where: { featureKey: 'GOLD_PRICE_CALCULATOR', isEnabled: true },
            select: { accountId: true }
        });

        Logger.info(`[Scheduler] Updating gold prices for ${enabledAccounts.length} accounts`);

        for (const { accountId } of enabledAccounts) {
            try {
                await GoldPriceService.updateAccountPrice(accountId);
                Logger.info(`[Scheduler] Updated gold price for account ${accountId}`);
            } catch (error) {
                Logger.error(`[Scheduler] Failed to update gold price for account ${accountId}`, { error });
            }
        }
    }

    /**
     * Dispatch BOM inventory sync for accounts with BOM products
     */
    static async dispatchBOMInventorySync() {
        Logger.info('[Scheduler] Starting hourly BOM inventory sync dispatch');

        try {
            const accountsWithBOM = await prisma.bOM.findMany({
                select: { product: { select: { accountId: true } } },
                distinct: ['productId']
            });

            const accountIds = [...new Set(accountsWithBOM.map(b => b.product.accountId))];
            Logger.info(`[Scheduler] Dispatching BOM sync for ${accountIds.length} accounts`);

            const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);

            for (const accountId of accountIds) {
                const jobId = `bom_sync_${accountId.replace(/:/g, '_')}`;

                const existingJob = await queue.getJob(jobId);
                if (existingJob) {
                    const state = await existingJob.getState();
                    if (['active', 'waiting', 'delayed'].includes(state)) {
                        Logger.info(`[Scheduler] Skipping BOM sync for ${accountId} - job already ${state}`);
                        continue;
                    }
                    try { await existingJob.remove(); } catch { /* ignore */ }
                }

                await queue.add(QUEUES.BOM_SYNC, { accountId }, {
                    jobId,
                    priority: 1,
                    removeOnComplete: true,
                    removeOnFail: 100
                });
            }

            Logger.info(`[Scheduler] Dispatched BOM sync jobs for ${accountIds.length} accounts`);
        } catch (error) {
            Logger.error('[Scheduler] BOM inventory sync dispatch failed', { error });
        }
    }

    /**
     * Run scheduled account backups
     */
    static async dispatchScheduledBackups() {
        Logger.info('[Scheduler] Checking for scheduled account backups');

        try {
            const { AccountBackupService } = await import('../AccountBackupService');
            const result = await AccountBackupService.runScheduledBackups();

            if (result.processed > 0 || result.failed > 0) {
                Logger.info('[Scheduler] Scheduled backups complete', result);
            }
        } catch (error) {
            Logger.error('[Scheduler] Scheduled backups failed', { error });
        }
    }
}
