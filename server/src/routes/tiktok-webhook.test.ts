import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({
    prisma: { platformCredentials: { findUnique: vi.fn() } }
}));

vi.mock('../utils/logger', () => ({
    Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../services/messaging/TikTokMessagingService', () => ({
    TikTokMessagingService: {
        verifyWebhookSignature: vi.fn(),
        processWebhookEvent: vi.fn()
    }
}));

import tiktokWebhookRoutes from './tiktok-webhook';
import { prisma } from '../utils/prisma';
import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';

describe('TikTok webhook authentication', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.platformCredentials.findUnique).mockResolvedValue({
            credentials: { clientSecret: 'tiktok-secret' }
        } as any);
        vi.mocked(TikTokMessagingService.verifyWebhookSignature).mockReturnValue(true);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('preserves the provider challenge handshake', async () => {
        const fastify = Fastify();
        await fastify.register(tiktokWebhookRoutes);

        const response = await fastify.inject({ method: 'GET', url: '/?challenge=provider-challenge' });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('provider-challenge');
        await fastify.close();
    });

    it('rejects POST requests without signature headers', async () => {
        const fastify = Fastify();
        await fastify.register(tiktokWebhookRoutes);

        const response = await fastify.inject({ method: 'POST', url: '/', payload: { event: 'message' } });

        expect(response.statusCode).toBe(401);
        expect(TikTokMessagingService.processWebhookEvent).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('verifies the exact raw JSON body', async () => {
        const fastify = Fastify();
        await fastify.register(tiktokWebhookRoutes);
        const rawBody = '{ "event": "message", "message": {} }';

        const response = await fastify.inject({
            method: 'POST',
            url: '/',
            headers: {
                'content-type': 'application/json',
                'x-tiktok-signature': 'signature',
                'x-tiktok-timestamp': '12345'
            },
            payload: rawBody
        });

        expect(response.statusCode).toBe(200);
        expect(TikTokMessagingService.verifyWebhookSignature).toHaveBeenCalledWith(
            'signature',
            '12345',
            rawBody,
            'tiktok-secret'
        );
        await fastify.close();
    });

    it('fails closed when no client secret is configured', async () => {
        vi.mocked(prisma.platformCredentials.findUnique).mockResolvedValue(null);
        vi.stubEnv('TIKTOK_CLIENT_SECRET', '');
        const fastify = Fastify();
        await fastify.register(tiktokWebhookRoutes);

        const response = await fastify.inject({
            method: 'POST',
            url: '/',
            headers: { 'x-tiktok-signature': 'signature', 'x-tiktok-timestamp': '12345' },
            payload: { event: 'message' }
        });

        expect(response.statusCode).toBe(503);
        expect(TikTokMessagingService.processWebhookEvent).not.toHaveBeenCalled();
        await fastify.close();
    });
});
