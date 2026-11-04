import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({
    prisma: {
        account: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('../services/TrackingService', () => ({
    TrackingService: {
        processEvent: vi.fn(),
    },
}));

vi.mock('../services/tracking/BotShieldMetrics', () => ({
    incrementBotShieldMetric: vi.fn(),
}));

vi.mock('../services/sync/PurchaseOrderSync', () => ({ queuePurchaseOrderSync: vi.fn() }));
vi.mock('../services/sync/LiveStoreSync', () => ({ queueStoreChange: vi.fn() }));

import trackingIngestionRoutes from './trackingIngestion';
import { prisma } from '../utils/prisma';
import { TrackingService } from '../services/TrackingService';
import { queuePurchaseOrderSync } from '../services/sync/PurchaseOrderSync';
import { queueStoreChange } from '../services/sync/LiveStoreSync';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const LEGACY_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';

describe('tracking ingestion auth', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.mocked(queueStoreChange).mockReset().mockResolvedValue(undefined);
        vi.mocked(queuePurchaseOrderSync).mockReset().mockResolvedValue(undefined);
        (vi.mocked(prisma.account.findUnique) as any).mockImplementation(async ({ where }: any) => {
            if (where.id === ACCOUNT_ID) {
                return { id: ACCOUNT_ID, webhookSecret: 'valid-secret' } as any;
            }
            if (where.id === LEGACY_ACCOUNT_ID) {
                return { id: LEGACY_ACCOUNT_ID, webhookSecret: null } as any;
            }
            return null;
        });
        vi.mocked(TrackingService.processEvent).mockResolvedValue({ id: 'session-1' } as any);

        app = Fastify();
        await app.register(trackingIngestionRoutes);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('accepts unsigned live session events for existing plugin installs', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/events',
            payload: {
                accountId: ACCOUNT_ID,
                visitorId: 'visitor-1',
                type: 'pageview',
                url: 'https://shop.example.com/',
            },
        });

        expect(res.statusCode).toBe(200);
        expect(queuePurchaseOrderSync).not.toHaveBeenCalled();
        expect(TrackingService.processEvent).toHaveBeenCalledWith(expect.objectContaining({
            accountId: ACCOUNT_ID,
            visitorId: 'visitor-1',
            type: 'pageview',
            payload: {},
        }));
    });

    it.each(['/events', '/e'])('preserves Google click identifier type and GA stream context through %s', async url => {
        const payload = { orderId: 123, total: 49.95, gaSessionIds: { STREAM: '1770000123' }, fbc: 'fb.1.click', fbp: 'fb.1.browser' };
        const res = await app.inject({
            method: 'POST', url, headers: { authorization: 'Bearer valid-secret' },
            payload: {
                accountId: ACCOUNT_ID, visitorId: 'visitor-1', type: 'purchase',
                clickId: 'privacy-click', clickPlatform: 'google', clickIdType: 'wbraid',
                eventId: 'original-purchase', consentState: 'granted', payload,
            },
        });
        expect(res.statusCode).toBe(200);
        expect(queuePurchaseOrderSync).toHaveBeenCalledWith(ACCOUNT_ID, 123);
        expect(TrackingService.processEvent).toHaveBeenCalledWith(expect.objectContaining({
            clickId: 'privacy-click', clickPlatform: 'google', clickIdType: 'wbraid',
            eventId: 'original-purchase', consentState: 'granted', payload,
        }));
    });

    it('rejects unsigned conversion events without an order ID', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/events',
            payload: {
                accountId: ACCOUNT_ID,
                visitorId: 'visitor-1',
                type: 'purchase',
                url: 'https://shop.example.com/checkout/order-received/1',
                payload: { total: 49.95 },
            },
        });

        expect(res.statusCode).toBe(401);
        expect(queuePurchaseOrderSync).not.toHaveBeenCalled();
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
    });

    it('rejects unsigned Woo purchase events with an order ID', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/events',
            payload: {
                accountId: ACCOUNT_ID,
                visitorId: 'visitor-1',
                type: 'purchase',
                url: 'https://shop.example.com/checkout/order-received/1',
                payload: { orderId: 123, total: 49.95 },
            },
        });

        expect(res.statusCode).toBe(401);
        expect(queuePurchaseOrderSync).not.toHaveBeenCalled();
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
    });

    it.each(['/events', '/e'])('does not admit order work with an invalid account token on %s', async url => {
        const res = await app.inject({
            method: 'POST', url, headers: { authorization: 'Bearer another-account-secret' },
            payload: { accountId: ACCOUNT_ID, visitorId: 'visitor-1', type: 'purchase', payload: { orderId: 123 } }
        });
        expect(res.statusCode).toBe(401);
        expect(queuePurchaseOrderSync).not.toHaveBeenCalled();
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
    });

    it('rejects unsigned product views because they are conversion-forwarded', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/e',
            payload: {
                accountId: ACCOUNT_ID,
                visitorId: 'visitor-1',
                type: 'product_view',
                url: 'https://shop.example.com/product/example',
                payload: { productId: 123 },
            },
        });

        expect(res.statusCode).toBe(401);
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
    });

    it('accepts unsigned conversion events for accounts without a webhook secret', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/events',
            payload: {
                accountId: LEGACY_ACCOUNT_ID,
                visitorId: 'visitor-1',
                type: 'purchase',
                url: 'https://shop.example.com/checkout/order-received/1',
                payload: { orderId: 123, total: 49.95 },
            },
        });

        expect(res.statusCode).toBe(200);
        expect(queuePurchaseOrderSync).not.toHaveBeenCalled();
        expect(TrackingService.processEvent).toHaveBeenCalledWith(expect.objectContaining({
            accountId: LEGACY_ACCOUNT_ID,
            visitorId: 'visitor-1',
            type: 'purchase',
            payload: { orderId: 123, total: 49.95 },
        }));
    });

    it('accepts conversion events signed with the account webhook secret', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/events',
            headers: { authorization: 'Bearer valid-secret' },
            payload: {
                accountId: ACCOUNT_ID,
                visitorId: 'visitor-1',
                type: 'purchase',
                url: 'https://shop.example.com/checkout/order-received/1',
                payload: { total: 49.95 },
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        expect(TrackingService.processEvent).toHaveBeenCalledWith(expect.objectContaining({
            accountId: ACCOUNT_ID,
            visitorId: 'visitor-1',
            type: 'purchase',
            payload: { total: 49.95 },
        }));
    });

    it('validates and passes an immutable source event timestamp', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/events',
            headers: { authorization: 'Bearer valid-secret' },
            payload: {
                accountId: ACCOUNT_ID,
                visitorId: 'visitor-1',
                type: 'purchase',
                url: 'https://shop.example.com/order',
                eventId: 'event-1',
                occurredAt: '2026-07-21T10:11:12.000Z',
            },
        });

        expect(res.statusCode).toBe(200);
        expect(TrackingService.processEvent).toHaveBeenCalledWith(expect.objectContaining({
            occurredAt: new Date('2026-07-21T10:11:12.000Z'),
        }));
    });

    it.each(['/events', '/e'])('retries durable admission before analytics processing on %s', async url => {
        vi.mocked(queuePurchaseOrderSync).mockRejectedValueOnce(new Error('Redis unavailable'));
        const request = {
            method: 'POST' as const, url, headers: { authorization: 'Bearer valid-secret' },
            payload: { accountId: ACCOUNT_ID, visitorId: 'visitor-retry', type: 'purchase', eventId: 'same-event', payload: { order_id: '456' } }
        };
        expect((await app.inject(request)).statusCode).toBe(500);
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
        expect((await app.inject(request)).statusCode).toBe(200);
        expect(queuePurchaseOrderSync).toHaveBeenCalledTimes(2);
        expect(queuePurchaseOrderSync).toHaveBeenLastCalledWith(ACCOUNT_ID, 456);
    });

    it.each([undefined, 0, -1, 1.5, 'bad', 2147483648])('does not fetch malformed purchase order ID %s', async orderId => {
        const res = await app.inject({
            method: 'POST', url: '/events', headers: { authorization: 'Bearer valid-secret' },
            payload: { accountId: ACCOUNT_ID, visitorId: 'visitor-1', type: 'purchase', payload: { orderId } }
        });
        expect(res.statusCode).toBe(200);
        expect(queuePurchaseOrderSync).not.toHaveBeenCalled();
    });

    it('does not fetch orders from other event types even when signed', async () => {
        const res = await app.inject({
            method: 'POST', url: '/e', headers: { authorization: 'Bearer valid-secret' },
            payload: { accountId: ACCOUNT_ID, visitorId: 'visitor-1', type: 'pageview', payload: { orderId: 123 } }
        });
        expect(res.statusCode).toBe(200);
        expect(queuePurchaseOrderSync).not.toHaveBeenCalled();
    });

    it('admits the order fetch even when analytics filters or deduplicates the event', async () => {
        vi.mocked(TrackingService.processEvent).mockResolvedValueOnce(null as any);
        const res = await app.inject({
            method: 'POST', url: '/e', headers: { authorization: 'Bearer valid-secret' },
            payload: { accountId: ACCOUNT_ID, visitorId: 'visitor-1', type: 'purchase', payload: { orderId: 123 } }
        });
        expect(res.statusCode).toBe(200);
        expect(queuePurchaseOrderSync).toHaveBeenCalledWith(ACCOUNT_ID, 123);
    });

    it.each(['/events', '/e'])('handles authenticated operational store changes without analytics on %s', async url => {
        for (const [type, key] of [['order_changed', 'orderId'], ['customer_changed', 'customerId'], ['review_changed', 'reviewId']]) {
            const res = await app.inject({
                method: 'POST', url, headers: { authorization: 'Bearer valid-secret' },
                payload: { accountId: ACCOUNT_ID, visitorId: 'store-sync', type, payload: { [key]: '42', eventId: `${type}-event` } }
            });
            expect(res.statusCode).toBe(200);
            expect(queueStoreChange).toHaveBeenCalledWith(ACCOUNT_ID, type, 42, `${type}-event`);
        }
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
        expect(queuePurchaseOrderSync).not.toHaveBeenCalled();
    });

    it('requires authentication for operational signals even on legacy accounts', async () => {
        const res = await app.inject({ method: 'POST', url: '/e', payload: {
            accountId: LEGACY_ACCOUNT_ID, visitorId: 'store-sync', type: 'order_changed', payload: { orderId: 42, eventId: 'refund' }
        } });
        expect(res.statusCode).toBe(401);
        expect(queueStoreChange).not.toHaveBeenCalled();
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
    });

    it.each([{ orderId: 0, eventId: 'x' }, { orderId: 42 }, { orderId: 42, eventId: ' ' }, { orderId: 42, eventId: 3 }])('rejects malformed operational signals %j', async payload => {
        const res = await app.inject({ method: 'POST', url: '/e', headers: { authorization: 'Bearer valid-secret' }, payload: {
            accountId: ACCOUNT_ID, visitorId: 'store-sync', type: 'order_changed', payload
        } });
        expect(res.statusCode).toBe(400);
        expect(queueStoreChange).not.toHaveBeenCalled();
    });

    it('returns a retryable error when operational admission fails', async () => {
        vi.mocked(queueStoreChange).mockRejectedValueOnce(new Error('queue unavailable'));
        const res = await app.inject({ method: 'POST', url: '/e', headers: { authorization: 'Bearer valid-secret' }, payload: {
            accountId: ACCOUNT_ID, visitorId: 'store-sync', type: 'order_changed', payload: { orderId: 42, eventId: 'refund' }
        } });
        expect(res.statusCode).toBe(500);
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
    });

    it.each([['identify', 'customerId', 'customer_changed'], ['review', 'reviewId', 'review_changed']])('uses existing signed %s events as a compatibility signal', async (type, key, targetType) => {
        const res = await app.inject({ method: 'POST', url: '/events', headers: { authorization: 'Bearer valid-secret' }, payload: {
            accountId: ACCOUNT_ID, visitorId: 'visitor-1', type, payload: { [key]: 42, eventId: 'legacy-event' }
        } });
        expect(res.statusCode).toBe(200);
        expect(queueStoreChange).toHaveBeenCalledWith(ACCOUNT_ID, targetType, 42, 'legacy-event');
        expect(TrackingService.processEvent).toHaveBeenCalled();
    });

    it('does not double-import when a current plugin sends analytics alongside its dedicated store signal', async () => {
        const res = await app.inject({ method: 'POST', url: '/events', headers: { authorization: 'Bearer valid-secret' }, payload: {
            accountId: ACCOUNT_ID, visitorId: 'visitor-1', type: 'identify', payload: { customerId: 42, storeSyncSignal: true }
        } });
        expect(res.statusCode).toBe(200);
        expect(queueStoreChange).not.toHaveBeenCalled();
        expect(TrackingService.processEvent).toHaveBeenCalled();
    });

    it('rejects malformed source event timestamps', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/events',
            headers: { authorization: 'Bearer valid-secret' },
            payload: {
                accountId: ACCOUNT_ID,
                visitorId: 'visitor-1',
                type: 'purchase',
                url: 'https://shop.example.com/order',
                occurredAt: 'yesterday',
            },
        });

        expect(res.statusCode).toBe(400);
        expect(TrackingService.processEvent).not.toHaveBeenCalled();
    });
});
