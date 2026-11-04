import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueOrderStockRefresh, queueStoreChange } from './LiveStoreSync';
import { QueueFactory } from '../queue/QueueFactory';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../queue/QueueFactory', () => ({
    QUEUES: { ORDERS: 'orders', PRODUCTS: 'products', CUSTOMERS: 'customers', REVIEWS: 'reviews' },
    QueueFactory: { enforceMaxQueueDepth: vi.fn(), getQueue: vi.fn(() => ({ add })) }
}));

describe('live store dispatch', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it.each([
        ['order_changed', 'orders', 'wooOrderId'], ['customer_changed', 'customers', 'wooCustomerId'], ['review_changed', 'reviews', 'wooReviewId']
    ] as const)('routes %s to its targeted worker', async (type, queue, field) => {
        await queueStoreChange('a', type, 42, 'occurrence-1');
        expect(QueueFactory.getQueue).toHaveBeenCalledWith(queue);
        expect(add).toHaveBeenCalledWith('live-store-change', expect.objectContaining({ accountId: 'a', [field]: 42, liveEvent: type }), expect.objectContaining({ priority: 1, attempts: 5 }));
    });

    it('deduplicates retries of an occurrence but not subsequent order changes or other accounts', async () => {
        await queueStoreChange('a', 'order_changed', 42, 'paid');
        await queueStoreChange('a', 'order_changed', 42, 'paid');
        await queueStoreChange('a', 'order_changed', 42, 'refunded');
        await queueStoreChange('b', 'order_changed', 42, 'paid');
        const keys = add.mock.calls.map(call => call[2].deduplication.id);
        expect(keys[0]).toBe(keys[1]);
        expect(new Set(keys).size).toBe(3);
    });

    it('refreshes each authoritative parent once, including variation parents, without quantity math', async () => {
        await queueOrderStockRefresh('a', { id: 42, line_items: [
            { product_id: 10, variation_id: 11, quantity: 2 }, { product_id: 10, variation_id: 12 },
            { product_id: 20 }, { product_id: 0 }, { product_id: -1 }, { product_id: 2147483648 }, null
        ] }, 'paid-event');
        expect(add).toHaveBeenCalledTimes(2);
        expect(add.mock.calls.map(call => call[1])).toEqual([
            { accountId: 'a', wooProductId: 10, incremental: true, triggerSource: 'SYSTEM' },
            { accountId: 'a', wooProductId: 20, incremental: true, triggerSource: 'SYSTEM' }
        ]);
    });

    it('does not suppress another purchase of the same product', async () => {
        await queueOrderStockRefresh('a', { id: 1, line_items: [{ product_id: 10 }] });
        await queueOrderStockRefresh('a', { id: 2, line_items: [{ product_id: 10 }] });
        expect(add.mock.calls[0][2].deduplication.id).not.toBe(add.mock.calls[1][2].deduplication.id);
    });

    it('propagates admission failures for order retry', async () => {
        add.mockRejectedValueOnce(new Error('Redis down'));
        await expect(queueOrderStockRefresh('a', { id: 1, line_items: [{ product_id: 10 }] })).rejects.toThrow('Redis down');
    });
});
