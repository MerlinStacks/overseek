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
            deleteMany: vi.fn(),
            upsert: vi.fn(),
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
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                plugin: 'overseek-wc',
                capabilities: { emailPreferenceCenter: true },
                preferenceCenterReady: true,
            }),
        }));
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
        vi.mocked(prisma.emailUnsubscribe.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback({
            emailUnsubscribe: {
                deleteMany: prisma.emailUnsubscribe.deleteMany,
                upsert: prisma.emailUnsubscribe.upsert,
            },
        }));

        app = Fastify();
        await app.register(emailTrackingRoutes, { prefix: '/api/email' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.unstubAllGlobals();
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
        expect(res.headers.location).toBe('https://www.example.com/products/ring?overseek_review_request=track-1#review_form');
        expect(prisma.messageTrackingEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'CLICK',
                linkUrl: 'https://www.example.com/products/ring?overseek_review_request=track-1#review_form',
            }),
        });
    });

    it('redirects unsubscribe pages to the WooCommerce preference center when available', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/email/unsubscribe/track-1',
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe('https://shop.example.com/?overseek_email_preferences=track-1');
    });

    it('falls back to the hosted unsubscribe page when no store URL is available', async () => {
        vi.mocked(prisma.emailLog.findUnique).mockResolvedValueOnce({
            id: 'email-log-1',
            trackingId: 'track-1',
            accountId: 'acct-1',
            to: 'customer@example.com',
            sourceId: null,
            account: {
                name: 'Example Store',
                wooUrl: null,
            },
        } as any);

        const res = await app.inject({
            method: 'GET',
            url: '/api/email/unsubscribe/track-1',
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.body).toContain('Email Preferences');
    });

    it('falls back when the store plugin does not advertise preference-center support', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, plugin: 'overseek-wc', capabilities: {} }),
        } as Response);

        const res = await app.inject({ method: 'GET', url: '/api/email/unsubscribe/track-1' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Email Preferences');
    });

    it('falls back without fetching unsafe store URL schemes', async () => {
        vi.mocked(prisma.emailLog.findUnique).mockResolvedValueOnce({
            id: 'email-log-1', trackingId: 'track-1', accountId: 'acct-1',
            to: 'customer@example.com', sourceId: null,
            account: { name: 'Example Store', wooUrl: 'javascript:alert(1)' },
        } as any);

        const res = await app.inject({ method: 'GET', url: '/api/email/unsubscribe/track-1' });

        expect(res.statusCode).toBe(200);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('handles List-Unsubscribe one-click POSTs as marketing unsubscribes', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/email/unsubscribe/track-1',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
            payload: 'List-Unsubscribe=One-Click',
        });

        expect(res.statusCode).toBe(200);
        expect(prisma.emailUnsubscribe.upsert).toHaveBeenCalledWith({
            where: {
                accountId_email: {
                    accountId: 'acct-1',
                    email: 'customer@example.com',
                },
            },
            create: {
                accountId: 'acct-1',
                email: 'customer@example.com',
                scope: 'MARKETING',
                reason: null,
            },
            update: {
                scope: 'MARKETING',
                reason: null,
            },
        });
    });
});
