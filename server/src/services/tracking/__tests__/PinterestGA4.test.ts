import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinterestCAPIService } from '../PinterestCAPIService';
import { GA4MeasurementService } from '../GA4MeasurementService';

// Shared mocks for both services
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

describe('PinterestCAPIService', () => {
    const service = new PinterestCAPIService();
    const accountId = 'test-account';
    const config = { adAccountId: 'pin-ad-123', accessToken: 'pin-tok' };
    const session = { id: 'sess-1', email: 'user@test.com', ipAddress: '1.2.3.4', userAgent: 'Mozilla', country: 'AU' };

    const purchaseData: any = {
        accountId,
        visitorId: 'vis-1',
        type: 'purchase',
        url: 'https://store.com/order-received',
        eventId: 'evt-uuid-4',
        payload: {
            orderId: 400,
            total: 75.00,
            currency: 'USD',
            email: 'buyer@test.com',
            epq: 'pinterest-epik-123',
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
            ok: true, status: 200, text: async () => '{"events": []}',
        });
    });

    it('should use Pinterest v5 endpoint', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toContain('/v5/ad_accounts/pin-ad-123/events');
    });

    it('should map purchase to checkout', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].event_name).toBe('checkout');
    });

    it('should hash email as array (Pinterest format)', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const em = body.data[0].user_data.em;
        expect(Array.isArray(em)).toBe(true);
        expect(em[0]).toHaveLength(64);
    });

    it('should include epik click ID', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].user_data.click_id).toBe('pinterest-epik-123');
    });

    it('should use Bearer token auth', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const headers = (global.fetch as any).mock.calls[0][1].headers;
        expect(headers.Authorization).toBe('Bearer pin-tok');
    });
});

describe('GA4MeasurementService', () => {
    const service = new GA4MeasurementService();
    const accountId = 'test-account';
    const config = { measurementId: 'G-ABCDEF', apiSecret: 'secret-123' };
    const session = { id: 'sess-1', email: 'user@test.com', ipAddress: '1.2.3.4', userAgent: 'Mozilla', country: 'AU' };

    const purchaseData: any = {
        accountId,
        visitorId: 'vis-1',
        type: 'purchase',
        url: 'https://store.com/order-received',
        eventId: 'evt-uuid-5',
        payload: {
            orderId: 500,
            total: 199.99,
            currency: 'AUD',
            tax: 18.18,
            shipping: 10.00,
            gaClientId: 'GA1.1.1234567890.9876543210',
            customerId: 42,
            items: [{ id: '5', sku: 'PROD-5', name: 'Gadget', quantity: 1, price: 171.81 }],
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
            ok: true, status: 204, text: async () => '',
        });
    });

    it('should use GA4 Measurement Protocol endpoint', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toContain('google-analytics.com/mp/collect');
        expect(url).toContain('measurement_id=G-ABCDEF');
        expect(url).toContain('api_secret=secret-123');
    });

    it('should extract GA client ID from _ga cookie correctly', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        // GA1.1.1234567890.9876543210 → client_id = 1234567890.9876543210
        expect(body.client_id).toBe('1234567890.9876543210');
    });

    it('should fall back to visitorId when _ga cookie is absent', async () => {
        const noGAData = {
            ...purchaseData,
            payload: { ...purchaseData.payload, gaClientId: undefined },
        };

        await service.sendEvent(accountId, config, noGAData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.client_id).toBe('vis-1');
    });

    it('should include GA4 ecommerce format', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const event = body.events[0];

        expect(event.name).toBe('purchase');
        expect(event.params.value).toBe(199.99);
        expect(event.params.currency).toBe('AUD');
        expect(event.params.transaction_id).toBe('500');
        expect(event.params.tax).toBe(18.18);
        expect(event.params.shipping).toBe(10.00);
        expect(event.params.items).toHaveLength(1);
    });

    it('should include user_id when customerId is present', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.user_id).toBe('42');
    });

    it('should handle 204 No Content as success', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const { prisma } = await import('../../../utils/prisma');
        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'SENT', httpStatus: 204 }),
            })
        );
    });

    it('should use debug endpoint when configured', async () => {
        const debugConfig = { ...config, useDebugEndpoint: true };
        await service.sendEvent(accountId, debugConfig, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toContain('/debug/mp/collect');
    });
});
