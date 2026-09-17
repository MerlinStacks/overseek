import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processWebhookPayload } from './webhook';
import { prisma } from '../utils/prisma';
import { esClient } from '../utils/elastic';
import { IndexingService } from '../services/search/IndexingService';
import { EventBus } from '../services/events';
import { materializeContact } from '../services/ContactMaterialization';
import { queueContactProjection } from '../services/ContactProjection';

vi.mock('../services/ContactMaterialization', () => ({ materializeContact: vi.fn() }));
vi.mock('../services/ContactProjection', () => ({ queueContactProjection: vi.fn() }));

const { tx, state } = vi.hoisted(() => ({
    tx: { $queryRaw: vi.fn(), $executeRaw: vi.fn(), wooOrder: {
        findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn()
    } },
    state: { inTransaction: false }
}));
vi.mock('../utils/prisma', () => ({ prisma: {
    $transaction: vi.fn(), wooOrder: { count: vi.fn() }
} }));
vi.mock('../utils/elastic', () => ({ esClient: { delete: vi.fn(), bulk: vi.fn() } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/redis', () => ({ redisClient: { set: vi.fn() } }));
vi.mock('../services/search/IndexingService', () => ({ IndexingService: { indexOrder: vi.fn() } }));
vi.mock('../services/WebhookDeliveryService', () => ({ WebhookDeliveryService: {} }));
vi.mock('../services/CampaignTrackingService', () => ({ campaignTrackingService: { trackPurchase: vi.fn() } }));
vi.mock('../services/EmailListService', () => ({ emailListService: {} }));
vi.mock('../services/wholesale/reconciliation', () => ({ reconcileWholesaleProductsBestEffort: vi.fn() }));
vi.mock('../services/events', () => ({ EventBus: { emit: vi.fn() }, EVENTS: { ORDER: {
    CREATED: 'created', STATUS_CHANGED: 'status_changed', PAID: 'paid', COMPLETED: 'completed', FIRST: 'first', SYNCED: 'synced'
} } }));

const order = { id: 12, number: '12', status: 'completed', total: '12.34', currency: 'AUD',
    customer_id: 2, billing: { email: ' New@Example.com ' } };

describe('order webhook customer totals', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(materializeContact).mockResolvedValue({ id: 'contact' } as any);
        vi.mocked(prisma.$transaction).mockImplementation(async (work: any) => {
            state.inTransaction = true;
            try { return await work(tx); } finally { state.inTransaction = false; }
        });
        tx.wooOrder.findUnique.mockResolvedValue(null);
        tx.wooOrder.upsert.mockImplementation(async () => { expect(state.inTransaction).toBe(true); });
        tx.wooOrder.deleteMany.mockImplementation(async () => { expect(state.inTransaction).toBe(true); });
        tx.$executeRaw.mockImplementation(async () => { expect(state.inTransaction).toBe(true); });
        vi.mocked(prisma.wooOrder.count).mockResolvedValue(0);
        vi.mocked(IndexingService.indexOrder).mockImplementation(async () => { expect(state.inTransaction).toBe(false); });
        vi.mocked(esClient.delete).mockImplementation(async () => {
            expect(state.inTransaction).toBe(false);
            return {} as any;
        });
    });

    it('creates the order and calculates totals before indexing or emitting', async () => {
        await processWebhookPayload('a', 'order.created', order);
        expect(tx.$queryRaw).toHaveBeenCalledWith(expect.anything(), 'order-totals:a');
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.wooOrder.findUnique.mock.invocationCallOrder[0]);
        expect(tx.wooOrder.upsert.mock.invocationCallOrder[0]).toBeLessThan(tx.$executeRaw.mock.invocationCallOrder[0]);
        expect(tx.$executeRaw).toHaveBeenCalledWith(expect.anything(), 'a', [2], [], ['contact'], 'a');
        expect(materializeContact).toHaveBeenCalledWith(tx, 'a', expect.objectContaining({ source: 'ORDER', wooCustomerId: 2, email: 'new@example.com' }));
        expect(queueContactProjection).toHaveBeenCalledWith(tx, 'a', ['contact']);
        expect(IndexingService.indexOrder).toHaveBeenCalledWith('a', order);
        expect(EventBus.emit).toHaveBeenCalledWith('created', { accountId: 'a', order });
    });

    it.each([
        [1, 'old@example.com', 2, 'new@example.com', [1, 2], []],
        [1, 'old@example.com', 0, 'new@example.com', [1], ['new@example.com']],
        [null, 'old@example.com', 2, 'new@example.com', [2], ['old@example.com']],
        [null, 'old@example.com', 0, 'new@example.com', [], ['old@example.com', 'new@example.com']]
    ])('retains old/new associations (%s -> %s)', async (oldId, oldEmail, newId, newEmail, ids, emails) => {
        tx.wooOrder.findUnique.mockResolvedValue({ status: 'processing', wooCustomerId: oldId, billingEmail: oldEmail });
        await processWebhookPayload('a', 'order.updated', { ...order, customer_id: newId, billing: { email: newEmail } });
        expect(tx.wooOrder.findUnique).toHaveBeenCalledWith({
            where: { accountId_wooId: { accountId: 'a', wooId: 12 } },
            select: { wooId: true, status: true, wooCustomerId: true, billingEmail: true }
        });
        expect(tx.$executeRaw).toHaveBeenCalledWith(expect.anything(), 'a', ids, emails, ['contact'], 'a');
        expect(EventBus.emit).toHaveBeenCalledWith('status_changed', expect.objectContaining({ previousStatus: 'processing' }));
    });

    it('normalizes guest email and recalculates ordinary total changes and replays', async () => {
        tx.wooOrder.findUnique.mockResolvedValue({ status: 'completed', wooCustomerId: null, billingEmail: 'new@example.com' });
        const payload = { ...order, customer_id: 0, total: '99.99' };
        await processWebhookPayload('a', 'order.updated', payload);
        await processWebhookPayload('a', 'order.updated', payload);
        expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
        expect(tx.$executeRaw).toHaveBeenLastCalledWith(expect.anything(), 'a', [], ['new@example.com'], ['contact'], 'a');
        expect(tx.wooOrder.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ billingEmail: 'new@example.com', total: '99.99' })
        }));
        expect(EventBus.emit).not.toHaveBeenCalledWith('completed', expect.anything());
    });

    it('rejects aggregate failures without acknowledging side effects', async () => {
        tx.$executeRaw.mockRejectedValueOnce(new Error('aggregate failed'));
        await expect(processWebhookPayload('a', 'order.created', order)).rejects.toThrow('aggregate failed');
        expect(IndexingService.indexOrder).not.toHaveBeenCalled();
        expect(EventBus.emit).not.toHaveBeenCalled();
    });

    it('preserves excluded-status handling without mutating totals', async () => {
        await processWebhookPayload('a', 'order.updated', { ...order, status: 'checkout-draft' });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(IndexingService.indexOrder).not.toHaveBeenCalled();
    });

    it.each([2, null])('repairs the deleted order association (%s) in the same transaction', async wooCustomerId => {
        tx.wooOrder.findUnique.mockResolvedValue({ wooCustomerId, billingEmail: 'old@example.com' });
        await processWebhookPayload('a', 'order.deleted', { id: 12 });
        expect(tx.wooOrder.deleteMany).toHaveBeenCalledWith({ where: { accountId: 'a', wooId: 12 } });
        expect(tx.$executeRaw).toHaveBeenCalledWith(expect.anything(), 'a', wooCustomerId ? [2] : [],
            wooCustomerId ? [] : ['old@example.com'], [], 'a');
        expect(esClient.delete).toHaveBeenCalledWith({ index: 'orders', id: 'a_12' }, { requestTimeout: 10000, maxRetries: 0 });
        expect(EventBus.emit).not.toHaveBeenCalled();
    });

    it('retries ES deletion from the payload after SQL deletion has committed', async () => {
        tx.wooOrder.findUnique.mockResolvedValueOnce({ wooCustomerId: 2, billingEmail: null });
        vi.mocked(esClient.delete).mockRejectedValueOnce(new Error('ES unavailable'));
        await expect(processWebhookPayload('a', 'order.deleted', { id: 12 })).rejects.toThrow('ES unavailable');
        vi.mocked(esClient.delete).mockRejectedValueOnce({ meta: { statusCode: 404 } });
        await expect(processWebhookPayload('a', 'order.deleted', { id: 12 })).resolves.toBeUndefined();
        expect(tx.wooOrder.deleteMany).toHaveBeenCalledTimes(1);
        expect(esClient.delete).toHaveBeenCalledTimes(2);
    });

    it('does not delete the index entry when SQL aggregate repair rolls back', async () => {
        tx.wooOrder.findUnique.mockResolvedValue({ wooCustomerId: 2, billingEmail: null });
        tx.$executeRaw.mockRejectedValueOnce(new Error('aggregate failed'));
        await expect(processWebhookPayload('a', 'order.deleted', { id: 12 })).rejects.toThrow('aggregate failed');
        expect(esClient.delete).not.toHaveBeenCalled();
    });
});
