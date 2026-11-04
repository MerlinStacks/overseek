import { QueueFactory, QUEUES } from '../queue/QueueFactory';
import { recordPurchaseSignal } from './SyncFreshness';

/** Admit only an authenticated signal and an ID, never analytics order details. */
export async function queuePurchaseOrderSync(accountId: string, wooOrderId: number): Promise<void> {
    await recordPurchaseSignal(accountId, wooOrderId);
    await QueueFactory.enforceMaxQueueDepth(QUEUES.ORDERS);
    await QueueFactory.getQueue(QUEUES.ORDERS).add('purchase-order-sync', {
        accountId, wooOrderId, incremental: true, triggerSource: 'SYSTEM', liveEvent: 'purchase'
    }, {
        priority: 1,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        // Atomic across API instances, including repeats arriving after completion.
        // Retry transient failures and orders not yet visible through the Woo API.
        deduplication: { id: `purchase-order-${accountId}-${wooOrderId}`, ttl: 5 * 60 * 1000 }
    });
}
