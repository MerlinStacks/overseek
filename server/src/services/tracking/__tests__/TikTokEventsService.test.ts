import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TikTokEventsService } from '../TikTokEventsService';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        conversionDelivery: {
            create: vi.fn().mockResolvedValue({ id: 'delivery-1' }),
            update: vi.fn().mockResolvedValue({}),
        },
    },
}));

vi.mock('../../../utils/logger', () => ({
    Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

global.fetch = vi.fn();

describe('TikTokEventsService', () => {
    const service = new TikTokEventsService();
    const accountId = 'test-account';
    const config = { pixelCode: 'tt-px-1', accessToken: 'tt-tok-1', advancedMatching: true };
    const session = { id: 'sess-1', email: 'user@test.com', ipAddress: '1.2.3.4', userAgent: 'Mozilla', country: 'AU' };

    const purchaseData: any = {
        accountId,
        visitorId: 'vis-1',
        type: 'purchase',
        url: 'https://store.com/checkout/done',
        eventId: 'evt-uuid-2',
        payload: {
            orderId: 200,
            total: 120.00,
            currency: 'USD',
            email: 'buyer@test.com',
            ttp: 'tiktok-browser-id-1',
            clickId: 'tiktok-click-id-1',
            clickPlatform: 'tiktok',
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ code: 0, message: 'OK' }),
        });
    });

    it('should use TikTok Events API v1.3', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toContain('/v1.3/event/track');
    });

    it('should map purchase to CompletePayment', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        // v1.3 nests events inside a data array
        expect(body.data[0].event).toBe('CompletePayment');
    });

    it('should hash email in user context', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        // v1.3 places user data inside data[0].user, not body.context
        const email = body.data[0].user?.email;

        if (email) {
            expect(email).not.toBe('buyer@test.com');
            expect(email).toHaveLength(64);
        }
    });

    it('should include ttp browser ID separately from ttclid click ID', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        // v1.3 places ttclid inside the user object, not body.context
        expect(body.data[0].user?.ttp).toBe('tiktok-browser-id-1');
        expect(body.data[0].user?.ttclid).toBe('tiktok-click-id-1');
    });

    it('should use top-level click identity and hash the external ID', async () => {
        const addToCartData = {
            ...purchaseData,
            type: 'add_to_cart',
            clickId: 'top-level-ttclid',
            clickPlatform: 'tiktok',
            payload: {
                total: 20,
                currency: 'AUD',
                externalId: 'visitor-123',
            },
        };

        await service.sendEvent(accountId, config, addToCartData, null);

        const user = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0].user;
        expect(user.ttclid).toBe('top-level-ttclid');
        expect(user.external_id).toHaveLength(64);
        expect(user.external_id).not.toBe('visitor-123');
        expect(user).not.toHaveProperty('email');
        expect(user).not.toHaveProperty('phone');
        expect(user).not.toHaveProperty('phone_number');
    });

    it('should normalize phone numbers to E.164 before hashing', async () => {
        const addToCartData = {
            ...purchaseData,
            type: 'add_to_cart',
            payload: {
                billingPhone: '0412 345 678',
                billingCountry: 'AU',
            },
        };

        await service.sendEvent(accountId, config, addToCartData, null);

        const user = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0].user;
        expect(user.phone).toBe('bc65da54a3ddbacfdc93a0400f0a2d78e41c2180c8255015e9616facfe56f58a');
        expect(user).not.toHaveProperty('phone_number');
    });

    it('should emit the exact v1.3 user contract and golden hashes', async () => {
        const data = {
            ...purchaseData,
            clickId: 'canonical-ttclid',
            clickPlatform: 'TIKTOK',
            ttp: 'top-level-ttp',
            payload: {
                email: ' Buyer@Test.com ',
                billingPhone: '0412 345 678',
                billingCountry: 'AU',
                externalId: 'visitor-123',
                clickId: 'stale-click',
                clickPlatform: 'meta',
            },
        };

        await service.sendEvent(accountId, config, data, null);

        const user = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0].user;
        expect(user).toEqual({
            email: '10c37e3986af742159dd303b5e24f55169decaec4d249ebcffb588c759a7e4d8',
            phone: 'bc65da54a3ddbacfdc93a0400f0a2d78e41c2180c8255015e9616facfe56f58a',
            external_id: '29f52b9aaeeb8fb642c7dbcb0a796c53a0799048f182bba917d1a0ec600ae663',
            ttp: 'top-level-ttp',
            ttclid: 'canonical-ttclid',
        });
    });

    it('should omit optional PII but retain attribution identifiers when advanced matching is disabled', async () => {
        await service.sendEvent(accountId, { ...config, advancedMatching: false }, purchaseData, session);

        const user = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0].user;
        expect(user).toEqual({
            ip: '1.2.3.4',
            user_agent: 'Mozilla',
            ttp: 'tiktok-browser-id-1',
            ttclid: 'tiktok-click-id-1',
        });
    });

    it('should use dateCreated for immutable event time and canonical contentId', async () => {
        const data = {
            ...purchaseData,
            payload: {
                ...purchaseData.payload,
                dateCreated: '2025-02-03T04:05:06.000Z',
                items: [{ contentId: 'canonical-20', id: '20', sku: 'SKU20' }],
            },
        };

        await service.sendEvent(accountId, config, data, session);

        const event = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0];
        expect(event.event_time).toBe(1738555506);
        expect(event.properties.contents[0].content_id).toBe('canonical-20');
    });

    it('should include Access-Token header', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const headers = (global.fetch as any).mock.calls[0][1].headers;
        expect(headers['Access-Token']).toBe('tt-tok-1');
    });

    it('should detect TikTok API-level errors in 200 responses', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ code: 40001, message: 'Invalid pixel' }),
        });

        await service.sendEvent(accountId, config, purchaseData, session);

        const { prisma } = await import('../../../utils/prisma');
        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'FAILED' }),
            })
        );
    });

    it('should attach a request timeout signal', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        expect((global.fetch as any).mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
});
