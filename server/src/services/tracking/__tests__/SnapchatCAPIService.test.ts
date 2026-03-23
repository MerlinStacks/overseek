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
            sclid: 'snap-click-id-1',
            items: [{ id: '20', sku: 'SNAP-1', name: 'Item', quantity: 1, price: 85.00 }],
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
            ok: true, status: 200, text: async () => '{"status": "SUCCESS"}',
        });
    });

    it('should use Snapchat CAPI v3 endpoint', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toBe('https://tr.snapchat.com/v3/conversion');
    });

    it('should map purchase to PURCHASE', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].event_type).toBe('PURCHASE');
    });

    it('should include hashed email', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].hashed_email).toBeDefined();
        expect(body.data[0].hashed_email).toHaveLength(64);
        expect(body.data[0].hashed_email).not.toBe('buyer@snap.test');
    });

    it('should include sclid as click_id', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].click_id).toBe('snap-click-id-1');
    });

    it('should use event_tag for deduplication', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].event_tag).toBe('evt-uuid-snap-1');
    });

    it('should include Bearer token auth', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const headers = (global.fetch as any).mock.calls[0][1].headers;
        expect(headers.Authorization).toBe('Bearer snap-tok');
    });

    it('should include ecommerce data', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].price).toBe('85');
        expect(body.data[0].currency).toBe('AUD');
        expect(body.data[0].transaction_id).toBe('600');
        expect(body.data[0].number_items).toBe('1');
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
