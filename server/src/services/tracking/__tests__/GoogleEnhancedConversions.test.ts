import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleEnhancedConversionsService } from '../GoogleEnhancedConversionsService';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        adAccount: {
            findFirst: vi.fn(),
        },
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

describe('GoogleEnhancedConversionsService', () => {
    const service = new GoogleEnhancedConversionsService();
    const accountId = 'test-account';
    const config = { conversionActionId: 'conv-123', customerId: '123-456-7890' };
    const session = { id: 'sess-1', email: 'user@test.com', ipAddress: '1.2.3.4', userAgent: 'Mozilla', country: 'AU' };

    const purchaseData: any = {
        accountId,
        visitorId: 'vis-1',
        type: 'purchase',
        url: 'https://store.com/order-received',
        eventId: 'evt-uuid-3',
        payload: {
            orderId: 300,
            total: 250.00,
            currency: 'AUD',
            email: 'buyer@test.com',
            clickId: 'gclid-abc123',
            clickPlatform: 'google',
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok-test';

        (prisma.adAccount.findFirst as any).mockResolvedValue({
            id: 'ad-acc-1',
            accessToken: 'access-tok-1',
            refreshToken: 'refresh-tok-1',
        });

        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => '{"results": []}',
        });
    });

    it('should only process purchase events', async () => {
        const addToCartData = { ...purchaseData, type: 'add_to_cart' };
        await service.sendEvent(accountId, config, addToCartData, session);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should use Google Ads API v23', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toContain('/v23/');
        expect(url).toContain('1234567890'); // Dashes removed
    });

    it('should skip when no gclid or email available', async () => {
        const noMatchData = {
            ...purchaseData,
            payload: { ...purchaseData.payload, email: undefined, clickId: undefined, clickPlatform: undefined },
        };

        await service.sendEvent(accountId, config, noMatchData, { ...session, email: null });

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should include hashed email in userIdentifiers', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const adjustment = body.conversionAdjustments[0];
        const emailIdentifier = adjustment.userIdentifiers.find((u: any) => u.hashedEmail);

        expect(emailIdentifier).toBeDefined();
        expect(emailIdentifier.hashedEmail).toHaveLength(64);
    });

    it('should include gclid when click platform is google', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const adjustment = body.conversionAdjustments[0];

        expect(adjustment.gclidDateTimePair.gclid).toBe('gclid-abc123');
    });

    it('should use order_id for orderId in adjustment', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.conversionAdjustments[0].orderId).toBe('300');
    });

    it('should include developer-token header', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const headers = (global.fetch as any).mock.calls[0][1].headers;
        expect(headers['developer-token']).toBe('dev-tok-test');
    });

    it('should skip when no AdAccount with valid tokens exists', async () => {
        (prisma.adAccount.findFirst as any).mockResolvedValue(null);

        await service.sendEvent(accountId, config, purchaseData, session);

        expect(global.fetch).not.toHaveBeenCalled();
    });
});
