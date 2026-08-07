import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({
    prisma: { platformCredentials: { findUnique: vi.fn() } }
}));

vi.mock('../utils/logger', () => ({
    Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../services/messaging/MetaMessagingService', () => ({
    MetaMessagingService: {
        verifyWebhookSignature: vi.fn(),
        processWebhookEvent: vi.fn()
    }
}));

import metaWebhookRoutes from './meta-webhook';
import { prisma } from '../utils/prisma';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';

describe('Meta webhook authentication', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.platformCredentials.findUnique).mockResolvedValue({
            credentials: { appSecret: 'meta-secret', webhookVerifyToken: 'verify-token' }
        } as any);
        vi.mocked(MetaMessagingService.verifyWebhookSignature).mockReturnValue(true);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('rejects verification when no verify token is configured or supplied', async () => {
        vi.mocked(prisma.platformCredentials.findUnique).mockResolvedValue(null);
        vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', '');
        const fastify = Fastify();
        await fastify.register(metaWebhookRoutes);

        const response = await fastify.inject({ method: 'GET', url: '/?hub.mode=subscribe&hub.challenge=test' });

        expect(response.statusCode).toBe(403);
        await fastify.close();
    });

    it('preserves verification with the configured token and challenge', async () => {
        const fastify = Fastify();
        await fastify.register(metaWebhookRoutes);

        const response = await fastify.inject({
            method: 'GET',
            url: '/?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=provider-challenge'
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('provider-challenge');
        await fastify.close();
    });

    it('rejects POST requests without a signature', async () => {
        const fastify = Fastify();
        await fastify.register(metaWebhookRoutes);

        const response = await fastify.inject({ method: 'POST', url: '/', payload: { object: 'page' } });

        expect(response.statusCode).toBe(401);
        expect(MetaMessagingService.processWebhookEvent).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('verifies the exact raw JSON body', async () => {
        const fastify = Fastify();
        await fastify.register(metaWebhookRoutes);
        const rawBody = '{ "object": "page", "entry": [] }';

        const response = await fastify.inject({
            method: 'POST',
            url: '/',
            headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'signature' },
            payload: rawBody
        });

        expect(response.statusCode).toBe(200);
        expect(MetaMessagingService.verifyWebhookSignature).toHaveBeenCalledWith('signature', rawBody, 'meta-secret');
        await fastify.close();
    });

    it('fails closed when no app secret is configured', async () => {
        vi.mocked(prisma.platformCredentials.findUnique).mockResolvedValue(null);
        vi.stubEnv('META_APP_SECRET', '');
        const fastify = Fastify();
        await fastify.register(metaWebhookRoutes);

        const response = await fastify.inject({
            method: 'POST',
            url: '/',
            headers: { 'x-hub-signature-256': 'signature' },
            payload: { object: 'page' }
        });

        expect(response.statusCode).toBe(503);
        expect(MetaMessagingService.processWebhookEvent).not.toHaveBeenCalled();
        await fastify.close();
    });
});
