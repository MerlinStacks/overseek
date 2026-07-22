import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        conversionEventReceipt: { create: vi.fn(), delete: vi.fn() },
        analyticsSession: { findUnique: vi.fn() },
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
