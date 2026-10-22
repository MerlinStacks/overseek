import { QueueFactory } from '../queue/QueueFactory';
import { prisma } from '../../utils/prisma';
import { SHIPPING_FEATURE_KEY } from '../shipping/ShippingService';
import { shippingTrackingService } from '../shipping/ShippingTrackingService';
import { admittedTracking } from '../shipping/TrackingAdmission';
export class ShippingTrackingScheduler {
    private static queue = QueueFactory.createQueue('scheduler');
    private static registered = false;
    private static registering: Promise<void> | null = null;
    static async register() {
        if (this.registered) return;
        if (this.registering) return this.registering;
        this.registering = (async () => {
            await this.queue.add('shipping-tracking-poll', {}, { repeat: { pattern: '*/30 * * * *' }, jobId: 'shipping-tracking-poll-30min' });
            // Storage deletion intentionally not scheduled until file/print/recovery ownership is atomic.
            this.registered = true;
        })();
        try { await this.registering; } finally { this.registering = null; }
    }
    static async dispatchTrackingPoll() {
        const deadline = Date.now() + 240000, occurrence = String(Math.floor(Date.now() / 1800000));
        const outcomes: Array<{ accountId: string; labelId?: string; state: string }> = [];
        let cursor: string | undefined;
        for (let page = 0; page < 4 && Date.now() < deadline; page++) {
            const accounts = await prisma.accountFeature.findMany({ where: { featureKey: SHIPPING_FEATURE_KEY, isEnabled: true, ...(cursor ? { accountId: { gt: cursor } } : {}) }, orderBy: { accountId: 'asc' }, take: 25, select: { accountId: true } });
            for (const { accountId } of accounts) {
                if (Date.now() >= deadline) return { state: 'partial', outcomes };
                const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST', isEnabled: true }, select: { config: true, credentialsEncrypted: true } });
                if (!settings?.credentialsEncrypted || (settings.config as any)?.trackingSyncEnabled !== true) { outcomes.push({ accountId, state: 'not-explicitly-enabled' }); continue; }
                const labels = await prisma.shippingLabel.findMany({ where: { accountId, cancelledAt: null, trackingNumber: { not: null }, status: { notIn: ['cancelled', 'delivered', 'returned', 'expired'] }, OR: [{ trackingSyncedAt: null }, { trackingSyncedAt: { lt: new Date(Date.now() - 1800000) } }] }, orderBy: [{ trackingSyncedAt: 'asc' }, { id: 'asc' }], take: 5, select: { id: true, updatedAt: true } });
                for (const label of labels) {
                    if (Date.now() >= deadline) return { state: 'partial', outcomes };
                    try { await admittedTracking(accountId, label.id, `scheduled:${occurrence}`, label.updatedAt.toISOString(), () => shippingTrackingService.refreshTrackingFromCarrier(accountId, label.id)); outcomes.push({ accountId, labelId: label.id, state: 'acknowledged' }); }
                    catch { outcomes.push({ accountId, labelId: label.id, state: 'unavailable-or-reconciliation-required' }); }
                }
                if (labels.length === 5) outcomes.push({ accountId, state: 'label-window-capped' });
            }
            if (accounts.length < 25) return { state: 'bounded-window', outcomes };
            cursor = accounts.at(-1)!.accountId;
        }
        return { state: 'partial', outcomes };
    }
    static async dispatchLabelStorageCleanup() { return { state: 'disabled', reason: 'Reviewed file/print/recovery ownership protocol required; no files or references removed' }; }
}
