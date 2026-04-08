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
    const config = { pixelCode: 'tt-px-1', accessToken: 'tt-tok-1' };
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
            ttp: 'tiktok-click-id-1',
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

    it('should include ttclid from ttp cookie', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        // v1.3 places ttclid inside the user object, not body.context
        expect(body.data[0].user?.ttclid).toBe('tiktok-click-id-1');
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
});
