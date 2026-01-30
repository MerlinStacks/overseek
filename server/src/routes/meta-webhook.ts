/**
 * Meta Webhook Routes - Fastify Plugin
 * Handles incoming webhooks from Facebook Messenger and Instagram DMs.
 */

import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../utils/logger';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';
import { prisma } from '../utils/prisma';

const metaWebhookRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /api/webhook/meta
     * Webhook verification endpoint.
     */
    fastify.get('/', async (request, reply) => {
        const query = request.query as { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
        const mode = query['hub.mode'];
        const token = query['hub.verify_token'];
        const challenge = query['hub.challenge'];

        Logger.info('[Meta Webhook] Verification request', { mode, hasToken: !!token });

        const credentials = await prisma.platformCredentials.findUnique({
            where: { platform: 'META_MESSAGING' },
        });

        const expectedToken = credentials?.credentials
            ? (credentials.credentials as any).webhookVerifyToken
            : process.env.META_WEBHOOK_VERIFY_TOKEN;

        if (mode === 'subscribe' && token === expectedToken) {
            Logger.info('[Meta Webhook] Verification successful');
            return reply.code(200).send(challenge);
        }

        Logger.warn('[Meta Webhook] Verification failed', { mode, token });
        return reply.code(403).send();
    });

    /**
     * POST /api/webhook/meta
     * Receives webhook events from Meta.
     */
    fastify.post('/', async (request, reply) => {
        try {
            const signature = request.headers['x-hub-signature-256'] as string;
            const body = request.body as any;

            Logger.info('[Meta Webhook] Event received', {
                object: body.object,
                entryCount: body.entry?.length,
            });

            if (signature) {
                const credentials = await prisma.platformCredentials.findUnique({
                    where: { platform: 'META_MESSAGING' },
                });

                const appSecret = credentials?.credentials
                    ? (credentials.credentials as any).appSecret
                    : process.env.META_APP_SECRET;

                if (appSecret) {
                    const rawBody = JSON.stringify(body);
                    const isValid = MetaMessagingService.verifyWebhookSignature(
                        signature,
                        rawBody,
                        appSecret
                    );

                    if (!isValid) {
                        Logger.warn('[Meta Webhook] Invalid signature');
                        return reply.code(403).send();
                    }
                }
            }

            // Respond immediately - Meta expects 200 within 20 seconds
            reply.code(200).send();

            // Process events asynchronously
            if (body.object === 'page' || body.object === 'instagram') {
                await MetaMessagingService.processWebhookEvent(body.entry || []);
            }

        } catch (error: any) {
            Logger.error('[Meta Webhook] Processing error', { error: error.message });
            return reply.code(200).send();
        }
    });
};

export default metaWebhookRoutes;
