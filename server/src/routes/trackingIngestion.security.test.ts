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

import trackingIngestionRoutes from './trackingIngestion';
import { prisma } from '../utils/prisma';
import { TrackingService } from '../services/TrackingService';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const LEGACY_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';

describe('tracking ingestion auth', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
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
        expect(TrackingService.processEvent).toHaveBeenCalledWith(expect.objectContaining({
            accountId: ACCOUNT_ID,
            visitorId: 'visitor-1',
            type: 'pageview',
            payload: {},
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
