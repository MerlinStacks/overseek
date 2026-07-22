import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MicrosoftCAPIService } from '../MicrosoftCAPIService';
import { TwitterCAPIService } from '../TwitterCAPIService';

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

const accountId = 'account-1';
const session = { id: 'session-1', userAgent: 'Mozilla/5.0', ipAddress: '1.2.3.4', country: 'AU' };
const event: any = {
    accountId,
    visitorId: 'visitor-1',
    type: 'purchase',
    url: 'https://shop.test/thank-you',
    eventId: 'dedup-123',
    occurredAt: '2026-07-20T04:05:06.000Z',
    clickId: 'top-level-click',
    payload: {
        orderId: 42,
        total: 25,
        currency: 'AUD',
        email: ' Buyer@Test.com ',
        billingPhone: '0412 345 678',
        billingCountry: 'AU',
    },
};

describe('MicrosoftCAPIService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    });

    it('merges top-level msclkid, normalizes phone, and preserves event time', async () => {
        await new MicrosoftCAPIService().sendEvent(
            accountId,
            { tagId: 'uet-1', accessToken: 'sas-token' },
            { ...event, clickPlatform: 'microsoft' },
            session,
        );

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body).events[0];
        expect(body.msclkid).toBe('top-level-click');
        expect(body.timestamp).toBe('2026-07-20T04:05:06.000Z');
        expect(body.enhanced_conversions[0].hashed_phone_number)
            .toBe('bc65da54a3ddbacfdc93a0400f0a2d78e41c2180c8255015e9616facfe56f58a');
    });
});

describe('TwitterCAPIService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => '{"data":{"conversions_processed":1}}',
        });
    });

    it('uses the configured Events Manager ID and event dedup ID in distinct fields', async () => {
        await new TwitterCAPIService().sendEvent(
            accountId,
            { pixelId: 'pixel-1', accessToken: 'token', eventIdPurchase: 'manager-event-9' },
            { ...event, clickPlatform: 'twitter' },
            session,
        );

        const [url, options] = (global.fetch as any).mock.calls[0];
        const conversion = JSON.parse(options.body).conversions[0];
        expect(url).toBe('https://ads-api.x.com/12/measurement/conversions/pixel-1');
        expect(conversion.event_id).toBe('manager-event-9');
        expect(conversion.conversion_id).toBe('dedup-123');
        expect(conversion.conversion_time).toBe('2026-07-20T04:05:06.000Z');
        expect(conversion.identifiers).toContainEqual({ twclid: 'top-level-click' });
    });

    it.each([undefined, 'ol288', '23294827', 'YOUR_EVENT_ID'])(
        'safely skips missing or placeholder Events Manager ID %s',
        async (configuredId) => {
            await new TwitterCAPIService().sendEvent(
                accountId,
                { pixelId: 'pixel-1', accessToken: 'token', eventIds: { purchase: configuredId } },
                event,
                session,
            );
            expect(global.fetch).not.toHaveBeenCalled();
        },
    );
});
