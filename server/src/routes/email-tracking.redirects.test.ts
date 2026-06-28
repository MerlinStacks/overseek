import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({
    prisma: {
        emailLog: {
            findUnique: vi.fn(),
        },
        messageTrackingEvent: {
            create: vi.fn(),
        },
        emailUnsubscribe: {
            findFirst: vi.fn(),
        },
        $transaction: vi.fn(),
    },
}));

vi.mock('../services/CampaignTrackingService', () => ({
    campaignTrackingService: {
        trackOpen: vi.fn(),
        trackClick: vi.fn(),
        trackEvent: vi.fn(),
    },
}));

import emailTrackingRoutes from './email-tracking';
import { prisma } from '../utils/prisma';

describe('email click redirects', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.mocked(prisma.emailLog.findUnique).mockResolvedValue({
            id: 'email-log-1',
            trackingId: 'track-1',
            accountId: 'acct-1',
            to: 'customer@example.com',
            sourceId: null,
            account: {
                wooUrl: 'https://shop.example.com',
                domain: 'example.com',
            },
        } as any);

        app = Fastify();
        await app.register(emailTrackingRoutes, { prefix: '/api/email' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('rejects off-domain click redirects', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/email/click/track-1?url=${encodeURIComponent('https://evil.example.net/phish')}`,
        });

        expect(res.statusCode).toBe(400);
        expect(prisma.messageTrackingEvent.create).not.toHaveBeenCalled();
    });

    it('allows redirects to the account store domain', async () => {
        const target = 'https://www.example.com/products/ring#review_form';
        const res = await app.inject({
            method: 'GET',
            url: `/api/email/click/track-1?url=${encodeURIComponent(target)}`,
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe('https://www.example.com/products/ring?overseek_review_request=1#review_form');
        expect(prisma.messageTrackingEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'CLICK',
                linkUrl: 'https://www.example.com/products/ring?overseek_review_request=1#review_form',
            }),
        });
    });
});
