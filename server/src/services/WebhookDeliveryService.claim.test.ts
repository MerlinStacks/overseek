import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ updateMany: vi.fn(), findFirst: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { webhookDelivery: m } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn() } }));
import { WebhookDeliveryService } from './WebhookDeliveryService';
beforeEach(() => { vi.resetAllMocks(); });
describe('atomic webhook replay claims', () => {
    it('conditionally claims only a failed delivery in the verified account/time/source/topic snapshot', async () => {
        const now = new Date(); const expected = { now, receivedAt: new Date(now.getTime() - 1000), source: 'WOOCOMMERCE', topic: 'order.deleted' };
        m.updateMany.mockResolvedValue({ count: 1 }); m.findFirst.mockResolvedValue({ id: 'delivery', accountId: 'tenant', topic: 'order.deleted', source: 'WOOCOMMERCE', payload: { id: 42 }, receivedAt: expected.receivedAt, attempts: 1 });
        expect(await WebhookDeliveryService.replay('delivery', 'tenant', expected)).toMatchObject({ id: 'delivery', accountId: 'tenant' });
        expect(m.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'delivery', accountId: 'tenant', status: 'FAILED', source: 'WOOCOMMERCE', topic: 'order.deleted', receivedAt: { equals: expected.receivedAt, lte: now, gte: new Date(now.getTime() - 86400000) } });
    });
    it('does not read or process a delivery after losing its claim', async () => {
        m.updateMany.mockResolvedValue({ count: 0 }); expect(await WebhookDeliveryService.replay('delivery', 'tenant')).toBeNull(); expect(m.findFirst).not.toHaveBeenCalled();
    });
});
