import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateOrderEmailContext } from '../orderEmailContext';
import { prisma } from '../../../utils/prisma';
import { resolveMergeTags } from '../../MergeTagResolver';
import { snapshotFixture, snapshotMetadata } from './snapshotFixture';
vi.mock('../../../utils/prisma', () => ({ prisma: { wooOrder: { findFirst: vi.fn() } } }));
describe('exact existing-order email context', () => {
    beforeEach(() => vi.clearAllMocks());
    it.each([{ orderId: 42 }, { order: { id: 42 } }, { rawOrder: { id: 42 } }, { wooId: 42, order_key: 'wc_order_abc' }, { order: { wooId: 42 } }])('hydrates exact account and Woo order %j', async context => {
        const snapshot = snapshotFixture();
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: { line_items: [{ name: 'Original' }] }, deliveryEstimateSnapshot: snapshot } as any);
        const result = await hydrateOrderEmailContext('account-a', context);
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledWith({ where: { accountId: 'account-a', wooId: 42 }, select: { rawData: true, deliveryEstimateSnapshot: true } });
        expect(result?.deliveryEstimateSnapshot).toEqual(snapshot);
        expect(result?.line_items).toEqual([{ name: 'Original' }]);
    });
    it('uses internal id without an unscoped or latest-order fallback', async () => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue(null);
        const result = await hydrateOrderEmailContext('other-account', { order: { id: 'internal-id', meta_data: snapshotMetadata(snapshotFixture()) } });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'other-account', id: 'internal-id' } }));
        expect(resolveMergeTags('{{delivery_estimate}}{{order.estimatedDelivery}}', { order: result })).toBe('');
    });
    it.each([{}, { wooId: 42 }, { id: 42, billing: { email: 'new@test.com' } }, { customer: { id: 42 } }, { product: { id: 42 } }, { rawData: { id: 42, name: 'Product' } }, { cart: { items: [{ id: 42 }] } }, { id: 42, email: 'contact@test.com' }])('non-order context stays blank %j', async context => {
        const order = await hydrateOrderEmailContext('account-a', context);
        expect(prisma.wooOrder.findFirst).not.toHaveBeenCalled();
        expect(resolveMergeTags('{{delivery_estimate}}{{order.estimatedFulfilment}}', { order })).toBe('');
    });
    it('stored snapshot wins changed payload, preserves other event fields', async () => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: { status: 'pending' }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        const order = await hydrateOrderEmailContext('a', { order: { id: 42, status: 'completed', deliveryEstimateSnapshot: null } });
        expect(order?.status).toBe('completed');
        expect(resolveMergeTags('{{order.estimatedDelivery}}', { order })).toBe('25 Sept 2026 – 28 Sept 2026');
    });
    it('invalid persisted value suppresses raw metadata and safely escapes fallback', async () => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: { meta_data: snapshotMetadata(snapshotFixture()) }, deliveryEstimateSnapshot: {} } as any);
        const order = await hydrateOrderEmailContext('a', { orderId: 42 });
        expect(resolveMergeTags('{{order.estimatedDelivery | fallback: "<script>"}}{{delivery_estimate heading:Oops}}', { order })).toBe('&lt;script&gt;');
    });
});
