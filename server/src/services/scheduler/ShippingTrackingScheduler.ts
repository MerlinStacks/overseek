import { QueueFactory } from '../queue/QueueFactory';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SHIPPING_FEATURE_KEY } from '../shipping/ShippingService';
import { shippingService } from '../shipping/ShippingService';
import { shippingTrackingService } from '../shipping/ShippingTrackingService';

export class ShippingTrackingScheduler {
    private static queue = QueueFactory.createQueue('scheduler');

    static async register() {
        await this.queue.add('shipping-tracking-poll', {}, {
            repeat: { pattern: '*/30 * * * *' },
            jobId: 'shipping-tracking-poll-30min',
        });
        await this.queue.add('shipping-label-storage-cleanup', {}, {
            repeat: { pattern: '17 2 * * *' },
            jobId: 'shipping-label-storage-cleanup-daily',
        });
        Logger.info('Scheduled Shipping Tracking Poll (Every 30 minutes)');
        Logger.info('Scheduled Shipping Label Storage Cleanup (Daily)');
    }

    static async dispatchTrackingPoll() {
        const enabledAccounts = await prisma.accountFeature.findMany({
            where: { featureKey: SHIPPING_FEATURE_KEY, isEnabled: true },
            select: { accountId: true },
        });

        Logger.info(`[ShippingTrackingScheduler] Polling tracking for ${enabledAccounts.length} Shipping Hub account(s)`);

        for (const { accountId } of enabledAccounts) {
            try {
                const settings = await prisma.shippingCarrierAccount.findFirst({
                    where: { accountId, carrier: 'AUSPOST', isEnabled: true },
                    select: { config: true, credentialsEncrypted: true },
                });
                const config = (settings?.config as Record<string, unknown> | null) || {};
                if (!settings?.credentialsEncrypted || config.trackingSyncEnabled === false) continue;

                const result = await shippingTrackingService.pollActiveLabels(accountId);
                Logger.info('[ShippingTrackingScheduler] Tracking poll completed', { accountId, ...result });
                if (result.failed > 0 || result.adapterUnavailable > 0) {
                    Logger.warn('[ShippingTrackingScheduler] Tracking poll requires attention', {
                        accountId,
                        failed: result.failed,
                        adapterUnavailable: result.adapterUnavailable,
                        checked: result.checked,
                        updated: result.updated,
                    });
                }
            } catch (error) {
                Logger.error('[ShippingTrackingScheduler] Tracking poll failed', { accountId, error });
            }
        }
    }

    static async dispatchLabelStorageCleanup() {
        const result = await shippingService.cleanupExpiredStoredLabels();
        Logger.info('[ShippingTrackingScheduler] Label storage cleanup completed', result);
        return result;
    }
}
