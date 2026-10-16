import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        conversionEventReceipt: { create: vi.fn(), delete: vi.fn() },
        analyticsSession: { findUnique: vi.fn(), upsert: vi.fn() },
        analyticsVisit: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
        analyticsEvent: { create: vi.fn() },
    },
}));
vi.mock('../GeoIPService', () => ({ geoipLookupSync: vi.fn() }));
vi.mock('../TrafficAnalyzer', () => ({
    parseTrafficSource: vi.fn(),
    isBot: vi.fn(() => false),
    maskIpAddress: vi.fn((value) => value),
}));
vi.mock('../IpExclusionService', () => ({ isExcludedIp: vi.fn(() => false) }));
vi.mock('../ConversionForwarder', () => ({ ConversionForwarder: { forwardIfConversion: vi.fn() } }));
vi.mock('../CrawlerService', () => ({ logHitIfIdentifiable: vi.fn() }));
vi.mock('../../AutomationEnrollmentService', () => ({ automationEnrollmentService: {} }));

import { prisma } from '../../../utils/prisma';
import { processEvent } from '../EventProcessor';
import { isExcludedIp } from '../IpExclusionService';

describe('EventProcessor conversion idempotency', () => {
    beforeEach(() => vi.clearAllMocks());

    it('short-circuits duplicate account event IDs before analytics and side effects', async () => {
        vi.mocked(prisma.conversionEventReceipt.create).mockRejectedValue({ code: 'P2002' });
        vi.mocked(prisma.analyticsSession.findUnique).mockResolvedValue({ id: 'session-1' } as any);

        const result = await processEvent({
            accountId: 'account-1',
            visitorId: 'visitor-1',
            type: 'purchase',
            url: 'https://shop.example.com/order',
            eventId: 'event-1',
            payload: { total: 10 },
        });

        expect(result).toEqual({ id: 'session-1' });
        expect(prisma.conversionEventReceipt.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                accountId: 'account-1',
                eventId: 'event-1',
                eventType: 'purchase',
            }),
        });
        expect(prisma.analyticsSession.findUnique).toHaveBeenCalledTimes(1);
    });
});

describe('EventProcessor AJAX page filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Stop accepted events at the next guard, before session persistence.
        vi.mocked(isExcludedIp).mockResolvedValue(true);
    });

    it.each(['pageview', 'product_view', 'cart_view', 'checkout_view'])(
        'drops %s events for AJAX cart URLs before session updates', async (type) => {
            const result = await processEvent({
                accountId: 'account-1', visitorId: 'visitor-1', type,
                url: '?wc-ajax=wcpa_ajax_add_to_cart', ipAddress: '127.0.0.1',
            });
            expect(result).toBeNull();
            expect(isExcludedIp).not.toHaveBeenCalled();
        }
    );

    it.each([
        'https://shop.test/?wc-ajax=wcpa_ajax_add_to_cart',
        '/cart/?other=1&wc-ajax=add_to_cart',
        '/?WC-AJAX=get_refreshed_fragments',
        '/?wc-ajax',
        '/wp-json/wc/store/v1/cart',
        '/wp-admin/admin-ajax.php',
        '/feed/',
        '/assets/app.js',
    ])('filters AJAX endpoint %s', async (url) => {
        await processEvent({
            accountId: 'account-1', visitorId: 'visitor-1', type: 'pageview',
            url, ipAddress: '127.0.0.1',
        });
        expect(isExcludedIp).not.toHaveBeenCalled();
    });

    it.each([
        ['add_to_cart', '/?wc-ajax=wcpa_ajax_add_to_cart'],
        ['purchase', '/?wc-ajax=checkout'],
        ['add_to_cart', '/wp-admin/admin-ajax.php'],
        ['pageview', '/cart/'],
        ['cart_view', '/cart/?coupon=gift'],
        ['pageview', '/?not-wc-ajax=add_to_cart'],
        ['pageview', '/#?wc-ajax=add_to_cart'],
    ])('preserves %s at %s', async (type, url) => {
        await processEvent({
            accountId: 'account-1', visitorId: 'visitor-1', type,
            url, ipAddress: '127.0.0.1',
        });
        expect(isExcludedIp).toHaveBeenCalledWith('account-1', '127.0.0.1');
    });
});

describe('EventProcessor live page state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isExcludedIp).mockResolvedValue(false);
        vi.mocked(prisma.analyticsSession.findUnique).mockResolvedValue({ id: 'session-1', totalVisits: 2 } as any);
        vi.mocked(prisma.analyticsSession.upsert).mockResolvedValue({ id: 'session-1', currentPath: '/product/gift/' } as any);
        vi.mocked(prisma.analyticsVisit.findFirst).mockResolvedValue({ id: 'visit-1', endedAt: new Date() } as any);
    });

    it.each(['/?wc-ajax=wcpa_ajax_add_to_cart', '/wp-admin/admin-ajax.php'])(
        'records cart updates at %s without replacing the live page', async url => {
            await processEvent({
                accountId: 'account-1', visitorId: 'visitor-1', type: 'add_to_cart', url,
                payload: { total: 25, currency: 'AUD' },
            });
            const { update } = vi.mocked(prisma.analyticsSession.upsert).mock.calls[0][0];
            expect(update).not.toHaveProperty('currentPath');
            expect(update).toMatchObject({ cartValue: 25, currency: 'AUD' });
            expect(prisma.analyticsEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
                type: 'add_to_cart', url, visitId: 'visit-1',
            }) });
            expect(prisma.analyticsVisit.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ pageviews: { increment: 0 } }),
            }));
        }
    );

    it('updates the live page for genuine specialized page visits', async () => {
        await processEvent({
            accountId: 'account-1', visitorId: 'visitor-1', type: 'cart_view', url: '/cart/',
        });
        expect(prisma.analyticsSession.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ currentPath: '/cart/' }),
        }));
    });
});
