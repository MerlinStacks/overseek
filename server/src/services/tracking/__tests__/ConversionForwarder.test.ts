import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversionForwarder, ConversionPlatformService } from '../ConversionForwarder';

// Mock prisma
vi.mock('../../../utils/prisma', () => ({
    prisma: {
        accountFeature: {
            findMany: vi.fn(),
        },
    },
}));

// Mock logger to suppress test output
vi.mock('../../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { prisma } from '../../../utils/prisma';

/** Helper: create a mock platform service */
function createMockService(platform: string): ConversionPlatformService & { sendEvent: ReturnType<typeof vi.fn> } {
    return {
        platform,
        sendEvent: vi.fn().mockResolvedValue(undefined),
    };
}

describe('ConversionForwarder', () => {
    let metaService: ReturnType<typeof createMockService>;
    let tiktokService: ReturnType<typeof createMockService>;

    beforeEach(() => {
        vi.clearAllMocks();
        // Clear internal caches by invalidating
        ConversionForwarder.invalidateCache('test-account');

        // Register fresh mock services
        metaService = createMockService('META');
        tiktokService = createMockService('TIKTOK');
        ConversionForwarder.register(metaService);
        ConversionForwarder.register(tiktokService);
    });

    const baseData = {
        accountId: 'test-account',
        visitorId: 'visitor-123',
        type: 'purchase',
        url: 'https://store.com/checkout/order-received',
        eventId: 'evt-uuid-123',
        payload: {
            orderId: 1001,
            total: 99.99,
            currency: 'USD',
            email: 'customer@test.com',
        },
    };

    const mockSession = {
        id: 'session-123',
        email: 'customer@test.com',
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla/5.0',
        country: 'AU',
    };

    it('should forward purchase events to enabled platforms', async () => {
        (prisma.accountFeature.findMany as any).mockResolvedValue([
            { featureKey: 'META_CAPI', isEnabled: true, config: { pixelId: 'px123', accessToken: 'tok' } },
            { featureKey: 'TIKTOK_EVENTS_API', isEnabled: true, config: { pixelCode: 'tt123', accessToken: 'tok' } },
        ]);

        await ConversionForwarder.forwardIfConversion(baseData as any, mockSession);

        expect(metaService.sendEvent).toHaveBeenCalledTimes(1);
        expect(tiktokService.sendEvent).toHaveBeenCalledTimes(1);
    });

    it('should NOT forward pageview events', async () => {
        const pageviewData = { ...baseData, type: 'pageview' };

        await ConversionForwarder.forwardIfConversion(pageviewData as any, mockSession);

        expect(metaService.sendEvent).not.toHaveBeenCalled();
        expect(tiktokService.sendEvent).not.toHaveBeenCalled();
    });

    it('should NOT forward when no platforms are enabled', async () => {
        (prisma.accountFeature.findMany as any).mockResolvedValue([]);

        await ConversionForwarder.forwardIfConversion(baseData as any, mockSession);

        expect(metaService.sendEvent).not.toHaveBeenCalled();
    });

    it('should swallow errors from platform services without throwing', async () => {
        (prisma.accountFeature.findMany as any).mockResolvedValue([
            { featureKey: 'META_CAPI', isEnabled: true, config: { pixelId: 'px123', accessToken: 'tok' } },
        ]);

        metaService.sendEvent.mockRejectedValue(new Error('Meta API is down'));

        // Should not throw
        await expect(
            ConversionForwarder.forwardIfConversion(baseData as any, mockSession)
        ).resolves.toBeUndefined();
    });

    it('should generate fallback eventId when plugin doesnt provide one', async () => {
        (prisma.accountFeature.findMany as any).mockResolvedValue([
            { featureKey: 'META_CAPI', isEnabled: true, config: { pixelId: 'px123', accessToken: 'tok' } },
        ]);

        const dataWithoutEventId = { ...baseData, eventId: undefined };
        await ConversionForwarder.forwardIfConversion(dataWithoutEventId as any, mockSession);

        // The data object should now have an eventId
        expect(dataWithoutEventId.eventId).toBeDefined();
        expect(typeof dataWithoutEventId.eventId).toBe('string');
        expect(metaService.sendEvent).toHaveBeenCalledTimes(1);
    });

    it('should forward add_to_cart events', async () => {
        (prisma.accountFeature.findMany as any).mockResolvedValue([
            { featureKey: 'TIKTOK_EVENTS_API', isEnabled: true, config: { pixelCode: 'tt123', accessToken: 'tok' } },
        ]);

        const addToCartData = { ...baseData, type: 'add_to_cart' };
        await ConversionForwarder.forwardIfConversion(addToCartData as any, mockSession);

        expect(tiktokService.sendEvent).toHaveBeenCalledTimes(1);
    });

    it('should handle one platform failing while others succeed', async () => {
        (prisma.accountFeature.findMany as any).mockResolvedValue([
            { featureKey: 'META_CAPI', isEnabled: true, config: { pixelId: 'px123', accessToken: 'tok' } },
            { featureKey: 'TIKTOK_EVENTS_API', isEnabled: true, config: { pixelCode: 'tt123', accessToken: 'tok' } },
        ]);

        metaService.sendEvent.mockRejectedValue(new Error('Meta down'));
        tiktokService.sendEvent.mockResolvedValue(undefined);

        await ConversionForwarder.forwardIfConversion(baseData as any, mockSession);

        // TikTok should still be called even though Meta failed
        expect(tiktokService.sendEvent).toHaveBeenCalledTimes(1);
        expect(metaService.sendEvent).toHaveBeenCalledTimes(1);
    });

    it('should respect per-platform event toggles and skip disabled events', async () => {
        (prisma.accountFeature.findMany as any).mockResolvedValue([
            {
                featureKey: 'META_CAPI',
                isEnabled: true,
                config: { pixelId: 'px123', accessToken: 'tok', events: { addToCart: false } },
            },
            {
                featureKey: 'TIKTOK_EVENTS_API',
                isEnabled: true,
                config: { pixelCode: 'tt123', accessToken: 'tok', events: { addToCart: true } },
            },
        ]);

        const addToCartData = { ...baseData, type: 'add_to_cart' };
        await ConversionForwarder.forwardIfConversion(addToCartData as any, mockSession);

        expect(metaService.sendEvent).not.toHaveBeenCalled();
        expect(tiktokService.sendEvent).toHaveBeenCalledTimes(1);
    });
});
