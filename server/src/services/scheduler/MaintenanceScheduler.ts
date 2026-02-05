/**
 * Maintenance Scheduler
 * 
 * Handles all maintenance/operational scheduling:
 * - Inventory alerts (daily)
 * - Gold price updates (daily)
 * - BOM inventory sync (hourly)
 * - Account backups (hourly)
 * - Janitor cleanup (daily)
 * - Meta token proactive refresh (daily)
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

        // EDGE CASE FIX: Proactive Meta Token Refresh (Daily at 04:00 UTC)
        // Refreshes tokens expiring within 7 days to prevent DM sync failures
        await this.queue.add('meta-token-refresh', {}, {
            repeat: { pattern: '0 4 * * *' },
            jobId: 'meta-token-refresh-daily'
        });
        Logger.info('Scheduled Meta Token Proactive Refresh (Daily at 4 AM UTC)');
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

        // Run order denormalization backfill once on startup (idempotent)
        import('../../scripts/backfillOrderFields').then(({ backfillOrderDenormalizedFields }) => {
            backfillOrderDenormalizedFields().catch(e => Logger.error('Order Backfill Error', { error: e }));
        }).catch(() => {
            // Script may not exist in older deployments - safe to ignore
        });
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

    /**
     * EDGE CASE FIX: Proactive Meta token refresh.
     * 
     * Meta long-lived tokens expire after ~60 days. This job runs daily
     * to refresh any tokens expiring within 7 days, preventing sudden
     * failures in DM sync and messaging features.
     * 
     * Creates notifications for accounts that fail to refresh after
     * multiple attempts.
     */
    static async dispatchMetaTokenRefresh() {
        Logger.info('[Scheduler] Starting proactive Meta token refresh');

        try {
            const MetaTokenService = (await import('../meta/MetaTokenService')).default;

            // Find Facebook/Instagram social accounts with tokens expiring in 7 days
            const sevenDaysFromNow = new Date();
            sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

            const expiringAccounts = await prisma.socialAccount.findMany({
                where: {
                    platform: { in: ['FACEBOOK', 'INSTAGRAM'] },
                    isActive: true,
                    tokenExpiry: {
                        not: null,
                        lte: sevenDaysFromNow
                    }
                },
                select: {
                    id: true,
                    accountId: true,
                    platform: true,
                    name: true,
                    accessToken: true,
                    tokenExpiry: true,
                    metadata: true
                }
            });

            if (expiringAccounts.length === 0) {
                Logger.info('[Scheduler] No Meta tokens expiring soon');
                return;
            }

            Logger.info(`[Scheduler] Found ${expiringAccounts.length} Meta tokens expiring soon`);

            let refreshed = 0;
            let failed = 0;

            for (const account of expiringAccounts) {
                try {
                    // Get user access token from metadata (stored during OAuth)
                    const metadata = account.metadata as any;
                    const userAccessToken = metadata?.userAccessToken;

                    if (!userAccessToken) {
                        Logger.warn(`[Scheduler] No user access token for ${account.platform} account ${account.name}`);
                        continue;
                    }

                    // Attempt token refresh
                    const refreshResult = await MetaTokenService.exchangeForLongLived(
                        userAccessToken,
                        'META_MESSAGING'
                    );

                    // Update the social account with new token expiry
                    await prisma.socialAccount.update({
                        where: { id: account.id },
                        data: {
                            tokenExpiry: refreshResult.expiresAt,
                            metadata: {
                                ...metadata,
                                userAccessToken: refreshResult.accessToken,
                                tokenExpiresAt: refreshResult.expiresAt.toISOString(),
                                lastRefreshed: new Date().toISOString()
                            }
                        }
                    });

                    refreshed++;
                    Logger.info(`[Scheduler] Refreshed ${account.platform} token for ${account.name}`, {
                        expiresAt: refreshResult.expiresAt.toISOString()
                    });

                } catch (error: any) {
                    failed++;
                    Logger.error(`[Scheduler] Failed to refresh ${account.platform} token for ${account.name}`, {
                        error: error.message
                    });

                    // Create notification for failed refresh
                    await prisma.notification.create({
                        data: {
                            accountId: account.accountId,
                            type: 'WARNING',
                            title: `${account.platform} Token Refresh Failed`,
                            message: `Unable to refresh access token for ${account.name}. Please reconnect the account in Settings > Connected Accounts to prevent service interruption.`,
                            link: '/settings?tab=channels'
                        }
                    }).catch((notifyErr: any) => {
                        Logger.error('[Scheduler] Failed to create token refresh notification', { error: notifyErr.message });
                    });
                }
            }

            Logger.info('[Scheduler] Meta token refresh complete', { refreshed, failed });

        } catch (error) {
            Logger.error('[Scheduler] Meta token refresh failed', { error });
        }
    }
}
