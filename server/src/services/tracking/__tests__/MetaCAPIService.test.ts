import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetaCAPIService } from '../MetaCAPIService';

// Mock prisma
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

import { prisma } from '../../../utils/prisma';

// Mock fetch globally
global.fetch = vi.fn();

describe('MetaCAPIService', () => {
    const service = new MetaCAPIService();
    const accountId = 'test-account';
    const config = { pixelId: 'px-123', accessToken: 'tok-abc', testEventCode: 'TEST123' };
    const session = { id: 'sess-1', email: 'user@example.com', ipAddress: '1.2.3.4', userAgent: 'Mozilla', country: 'AU' };

    const purchaseData: any = {
        accountId,
        visitorId: 'vis-1',
        type: 'purchase',
        url: 'https://store.com/order-received',
        eventId: 'evt-uuid-1',
        payload: {
            orderId: 100,
            total: 59.99,
            currency: 'AUD',
            email: 'buyer@test.com',
            items: [{ id: '10', sku: 'SKU1', name: 'Widget', quantity: 2, price: 29.99 }],
            fbc: 'fb.1.123',
            fbp: 'fb.1.456',
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => '{"events_received": 1}',
        });
    });

    it('should use Meta Graph API v25.0', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toContain('v25.0');
        expect(url).toContain('px-123');
    });

    it('should hash email in user_data using SHA-256', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const userData = body.data[0].user_data;

        // Email should be hashed, not plaintext
        expect(userData.em).toBeDefined();
        expect(userData.em).not.toBe('buyer@test.com');
        expect(userData.em).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('should include fbc and fbp cookies when present', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const userData = body.data[0].user_data;

        expect(userData.fbc).toBe('fb.1.123');
        expect(userData.fbp).toBe('fb.1.456');
    });

    it('should include test_event_code when configured', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.test_event_code).toBe('TEST123');
    });

    it('should map purchase to Purchase event name', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].event_name).toBe('Purchase');
    });

    it('should include custom_data with value and currency', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].custom_data.value).toBe(59.99);
        expect(body.data[0].custom_data.currency).toBe('AUD');
        expect(body.data[0].custom_data.contents).toHaveLength(1);
    });

    it('should log delivery to ConversionDelivery model', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        expect(prisma.conversionDelivery.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    accountId,
                    platform: 'META',
                    eventName: 'Purchase',
                    eventId: 'evt-uuid-1',
                    status: 'PENDING',
                }),
            })
        );

        // Should update to SENT after successful delivery
        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'SENT' }),
            })
        );
    });

    it('should skip when pixelId is missing', async () => {
        await service.sendEvent(accountId, { accessToken: 'tok' }, purchaseData, session);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should skip non-conversion events', async () => {
        const pageviewData = { ...purchaseData, type: 'pageview' };
        await service.sendEvent(accountId, config, pageviewData, session);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should mark delivery as FAILED on HTTP error', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 400,
            text: async () => '{"error": "Invalid pixel"}',
        });

        await service.sendEvent(accountId, config, purchaseData, session);

        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'FAILED', httpStatus: 400 }),
            })
        );
    });
});
