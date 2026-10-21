import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getDeliveries: vi.fn(), getDelivery: vi.fn(), replay: vi.fn(), markProcessed: vi.fn(), markFailed: vi.fn(), process: vi.fn(), getFailedCount: vi.fn() }));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async () => {}, requireSuperAdminFastify: async () => {} }));
vi.mock('../../services/WebhookDeliveryService', () => ({ WebhookDeliveryService: m }));
vi.mock('../webhook', () => ({ processWebhookPayload: m.process }));
import { webhookAdminRoutes } from './webhooks';
const delivery = () => ({ id: 'delivery', accountId: 'tenant', status: 'FAILED', source: 'WOOCOMMERCE', topic: 'order.deleted', receivedAt: new Date(), payload: { id: 42 } });
describe('webhook replay eligibility before mutation', () => {
    let app: FastifyInstance;
    beforeEach(async () => { vi.resetAllMocks(); m.getDelivery.mockImplementation(async () => delivery()); m.replay.mockImplementation(async () => delivery()); m.markProcessed.mockResolvedValue(undefined); m.process.mockResolvedValue(undefined); app = Fastify(); await app.register(webhookAdminRoutes); });
    afterEach(async () => { await app.close(); });
    it.each([{ receivedAt: new Date(0) }, { receivedAt: new Date('bad') }, { receivedAt: new Date(Date.now() + 86400000) }, { source: 'META' }, { topic: 'coupon.updated' }, { payload: { __truncated: true, id: 42 } }, { payload: null }, { payload: { id: true } }, { topic: 'order.updated', payload: { id: 42 } }])('rejects unsafe delivery %j before claiming', async patch => {
        m.getDelivery.mockResolvedValue({ ...delivery(), ...patch }); const response = await app.inject({ method: 'POST', url: '/webhooks/delivery/replay' }); expect(response.statusCode).toBe(400); expect(m.replay).not.toHaveBeenCalled(); expect(m.process).not.toHaveBeenCalled();
    });
    it('passes the owning account and immutable eligibility snapshot to the atomic claim', async () => {
        expect((await app.inject({ method: 'POST', url: '/webhooks/delivery/replay' })).statusCode).toBe(200); expect(m.replay).toHaveBeenCalledWith('delivery', 'tenant', expect.objectContaining({ source: 'WOOCOMMERCE', topic: 'order.deleted', receivedAt: expect.any(Date), now: expect.any(Date) })); expect(m.process).toHaveBeenCalledWith('tenant', 'order.deleted', { id: 42 });
    });
    it('does not process a lost claim or already-processed delivery', async () => {
        m.replay.mockResolvedValue(null); expect((await app.inject({ method: 'POST', url: '/webhooks/delivery/replay' })).statusCode).toBe(409); expect(m.process).not.toHaveBeenCalled();
        m.getDelivery.mockResolvedValue({ ...delivery(), status: 'PROCESSED' }); expect((await app.inject({ method: 'POST', url: '/webhooks/delivery/replay' })).statusCode).toBe(409);
    });
    it('keeps a successfully processed delivery claimed if audit confirmation fails', async () => {
        m.markProcessed.mockRejectedValue(new Error('DB unavailable')); const response = await app.inject({ method: 'POST', url: '/webhooks/delivery/replay' }); expect(response.statusCode).toBe(500); expect(response.json().error).toContain('remains claimed'); expect(m.markFailed).not.toHaveBeenCalled();
    });
    it.each(['page=-1', 'page=2x', 'limit=101', 'status=OTHER', 'source=OTHER'])('rejects invalid filters %s', async query => {
        expect((await app.inject({ url: `/webhooks?${query}` })).statusCode).toBe(400); expect(m.getDeliveries).not.toHaveBeenCalled();
    });
});
