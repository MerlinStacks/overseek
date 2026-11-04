import { createHash } from 'crypto';
import { QueueFactory, QUEUES } from '../queue/QueueFactory';
import { parseWooOrderId } from '../../utils/orderIds';
import { SyncJobData } from '../queue/SyncQueue';

type StoreChange = 'order_changed' | 'customer_changed' | 'review_changed';

/** Per-occurrence deduplication: a later status change must never be suppressed. */
export async function queueStoreChange(accountId: string, type: StoreChange, id: number, eventId: string): Promise<void> {
    const [queue, field] = type === 'order_changed' ? [QUEUES.ORDERS, 'wooOrderId']
        : type === 'customer_changed' ? [QUEUES.CUSTOMERS, 'wooCustomerId'] : [QUEUES.REVIEWS, 'wooReviewId'];
    await QueueFactory.enforceMaxQueueDepth(queue);
    const occurrence = createHash('sha256').update(eventId).digest('hex');
    await QueueFactory.getQueue(queue).add('live-store-change', {
        accountId, [field]: id, incremental: true, liveEvent: type, sourceEventId: eventId, triggerSource: 'SYSTEM'
    } satisfies SyncJobData, {
        priority: 1, attempts: 5, backoff: { type: 'exponential', delay: 2000 },
        deduplication: { id: `${type}-${accountId}-${id}-${occurrence}`, ttl: 60 * 60 * 1000 }
    });
}

/** Refresh parent snapshots and uncached variations, never apply quantity deltas. */
export async function queueOrderStockRefresh(accountId: string, order: { id: number; line_items?: unknown }, sourceEventId?: string): Promise<void> {
    if (!Array.isArray(order.line_items)) return;
    const ids = [...new Set(order.line_items.map(item => parseWooOrderId(item?.product_id)).filter((id): id is number => id !== null))];
    if (!ids.length) return;
    await QueueFactory.enforceMaxQueueDepth(QUEUES.PRODUCTS);
    const occurrence = createHash('sha256').update(sourceEventId || `purchase-${order.id}`).digest('hex');
    for (const wooProductId of ids) {
        await QueueFactory.getQueue(QUEUES.PRODUCTS).add('order-stock-refresh', {
            accountId, wooProductId, incremental: true, triggerSource: 'SYSTEM'
        } satisfies SyncJobData, {
            priority: 1, delay: 2000, attempts: 5, backoff: { type: 'exponential', delay: 2000 },
            deduplication: { id: `order-stock-${accountId}-${wooProductId}-${occurrence}`, ttl: 60 * 60 * 1000 }
        });
    }
}
