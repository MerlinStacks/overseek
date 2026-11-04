import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueFactory, QUEUES } from '../queue/QueueFactory';
import { queuePurchaseOrderSync } from './PurchaseOrderSync';
import { recordPurchaseSignal } from './SyncFreshness';
vi.mock('./SyncFreshness', () => ({ recordPurchaseSignal: vi.fn() }));

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../queue/QueueFactory', () => ({
    QUEUES: { ORDERS: 'sync-orders' },
    QueueFactory: { enforceMaxQueueDepth: vi.fn(), getQueue: vi.fn(() => ({ add })) }
}));

describe('purchase order queue admission', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('uses the existing order worker with scoped atomic deduplication and retries', async () => {
        await queuePurchaseOrderSync('account-a', 123);
        await queuePurchaseOrderSync('account-b', 123);
        expect(QueueFactory.enforceMaxQueueDepth).toHaveBeenCalledWith(QUEUES.ORDERS);
        expect(add).toHaveBeenNthCalledWith(1, 'purchase-order-sync', {
            accountId: 'account-a', wooOrderId: 123, incremental: true, triggerSource: 'SYSTEM', liveEvent: 'purchase'
        }, {
            priority: 1, attempts: 5, backoff: { type: 'exponential', delay: 2000 },
            deduplication: { id: 'purchase-order-account-a-123', ttl: 300000 }
        });
        expect(add.mock.calls[1][2].deduplication.id).toBe('purchase-order-account-b-123');
        expect(recordPurchaseSignal).toHaveBeenCalledWith('account-a', 123);
    });

    it('propagates queue backpressure without admitting work', async () => {
        vi.mocked(QueueFactory.enforceMaxQueueDepth).mockRejectedValueOnce(new Error('backpressure'));
        await expect(queuePurchaseOrderSync('account-a', 123)).rejects.toThrow('backpressure');
        expect(add).not.toHaveBeenCalled();
    });

    it('does not acknowledge Redis write failures', async () => {
        add.mockRejectedValueOnce(new Error('Redis unavailable'));
        await expect(queuePurchaseOrderSync('account-a', 123)).rejects.toThrow('Redis unavailable');
    });
});
