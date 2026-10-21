import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ logs: vi.fn(), auth: vi.fn(), apply: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { emailLog: { findMany: m.logs } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('./helpers', async original => ({ ...await original<typeof import('./helpers')>(), authenticateRelayEmailAccount: m.auth, applyDeliveryEventToLog: m.apply }));
import routes from './webhooks';
const event = { emailAccountId: 'sender', eventType: 'hard_bounce', messageId: 'message', trackingId: 'tracking', recipientEmail: 'to@test.example' };
describe('strict account/message-bound delivery correlation', () => {
    let app: FastifyInstance;
    beforeEach(async () => { vi.resetAllMocks(); m.auth.mockResolvedValue({ id: 'sender', accountId: 'tenant' }); m.logs.mockResolvedValue([{ id: 'log' }]); m.apply.mockResolvedValue({ status: 'BOUNCED', deliveryEventApplied: true, deliveryEventReason: 'APPLIED' }); app = Fastify(); await app.register(routes); });
    afterEach(async () => { await app.close(); });
    it('requires every supplied identifier to match and authenticates each sender only once', async () => {
        const response = await app.inject({ method: 'POST', url: '/delivery-events', headers: { 'x-relay-key': 'key' }, payload: [event, event] }); expect(response.statusCode).toBe(200); expect(m.auth).toHaveBeenCalledOnce();
        expect(m.logs.mock.calls[0][0].where).toEqual({ accountId: 'tenant', emailAccountId: 'sender', messageId: 'message', trackingId: 'tracking', to: { equals: 'to@test.example', mode: 'insensitive' } });
    });
    it('rejects missing account IDs and recipient-only events without credential scans', async () => {
        const response = await app.inject({ method: 'POST', url: '/delivery-events', headers: { 'x-relay-key': 'key' }, payload: { ...event, messageId: undefined, trackingId: undefined } }); expect(response.statusCode).toBe(400); expect(m.auth).not.toHaveBeenCalled();
    });
    it('does not mutate after invalid authentication or an ambiguous message match', async () => {
        m.auth.mockResolvedValueOnce(null); expect((await app.inject({ method: 'POST', url: '/delivery-events', headers: { 'x-relay-key': 'key' }, payload: event })).statusCode).toBe(401);
        m.logs.mockResolvedValue([{ id: 'one' }, { id: 'two' }]); const result = await app.inject({ method: 'POST', url: '/delivery-events', headers: { 'x-relay-key': 'key' }, payload: event }); expect(result.json().processedCount).toBe(0); expect(m.apply).not.toHaveBeenCalled();
    });
    it('does not report ignored updates as successfully applied', async () => {
        m.apply.mockResolvedValue({ deliveryEventApplied: false, deliveryEventReason: 'BOUNCE_TRACKING_DISABLED' }); const result = await app.inject({ method: 'POST', url: '/delivery-events', headers: { 'x-relay-key': 'key' }, payload: event }); expect(result.json().processedCount).toBe(0);
    });
    it('bounds batches before credential/database work', async () => {
        expect((await app.inject({ method: 'POST', url: '/delivery-events', headers: { 'x-relay-key': 'key' }, payload: Array(101).fill(event) })).statusCode).toBe(400); expect(m.auth).not.toHaveBeenCalled();
    });
});
