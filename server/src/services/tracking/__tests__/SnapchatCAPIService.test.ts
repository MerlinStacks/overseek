import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SnapchatCAPIService } from '../SnapchatCAPIService';

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

global.fetch = vi.fn();

describe('SnapchatCAPIService', () => {
    const service = new SnapchatCAPIService();
    const accountId = 'test-account';
    const config = { pixelId: 'snap-px-123', accessToken: 'snap-tok' };
    const session = { id: 'sess-1', email: 'user@test.com', ipAddress: '1.2.3.4', userAgent: 'Mozilla', country: 'AU' };

    const purchaseData: any = {
        accountId,
        visitorId: 'vis-1',
        type: 'purchase',
        url: 'https://store.com/order-received',
        eventId: 'evt-uuid-snap-1',
        payload: {
            orderId: 600,
            total: 85.00,
            currency: 'AUD',
            email: 'buyer@snap.test',
            billingPhone: '0412 345 678',
            billingCountry: 'AU',
            sclid: 'snap-click-id-1',
            dateCreated: '2026-07-20T01:02:03.000Z',
            items: [{ id: '20', sku: 'SNAP-1', name: 'Item', quantity: 1, price: 85.00 }],
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
            ok: true, status: 200, text: async () => '{"status": "VALID"}',
        });
    });

    it('should use Snapchat CAPI v3 endpoint', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toBe('https://tr.snapchat.com/v3/snap-px-123/events?access_token=snap-tok');
    });

    it('should map purchase to PURCHASE', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].event_name).toBe('PURCHASE');
        expect(body.data[0].action_source).toBe('WEB');
        expect(body.data[0].event_source_url).toBe(purchaseData.url);
    });

    it('should include hashed email', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].user_data.em[0]).toHaveLength(64);
        expect(body.data[0].user_data.em[0]).not.toBe('buyer@snap.test');
        expect(body.data[0].user_data.ph[0]).toBe('222e24d90b23ba2af558a2891bfa399f19a7eb9f33df34a7d6809b97c5a97246');
    });

    it('should distinguish the Snap click ID from the _scid cookie', async () => {
        const data = { ...purchaseData, clickId: 'top-level-sccid', clickPlatform: 'snapchat' };
        await service.sendEvent(accountId, config, data, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].user_data.sc_click_id).toBe('top-level-sccid');
        expect(body.data[0].user_data.sc_cookie1).toBe('snap-click-id-1');
    });

    it('should use event_id for deduplication and preserve the order time', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].event_id).toBe('evt-uuid-snap-1');
        expect(body.data[0].event_time).toBe(new Date('2026-07-20T01:02:03.000Z').getTime());
    });

    it('should use the documented access_token query parameter', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const [url, options] = (global.fetch as any).mock.calls[0];
        expect(url).toContain('access_token=snap-tok');
        expect(options.headers.Authorization).toBeUndefined();
    });

    it('should include ecommerce data', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].custom_data.value).toBe(85);
        expect(body.data[0].custom_data.currency).toBe('AUD');
        expect(body.data[0].custom_data.order_id).toBe('600');
        expect(body.data[0].custom_data.num_items).toBe('1');
    });

    it('should log delivery to ConversionDelivery model', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        expect(prisma.conversionDelivery.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    accountId,
                    platform: 'SNAPCHAT',
                    eventName: 'PURCHASE',
                    eventId: 'evt-uuid-snap-1',
                }),
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
});
