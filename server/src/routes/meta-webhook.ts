/**
 * Meta Webhook Routes - Fastify Plugin
 * Handles incoming webhooks from Facebook Messenger and Instagram DMs.
 */

import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../utils/logger';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';
import { prisma } from '../utils/prisma';

const metaWebhookRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.removeContentTypeParser('application/json');
    fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
        (request as any).rawBody = body;
        try {
            done(null, JSON.parse((body as Buffer).toString('utf8')));
        } catch (error) {
            done(error as Error, undefined);
        }
    });

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

        const expectedToken = (credentials?.credentials as any)?.webhookVerifyToken
            || process.env.META_WEBHOOK_VERIFY_TOKEN;

        if (mode === 'subscribe' && token && expectedToken && challenge !== undefined && token === expectedToken) {
            Logger.info('[Meta Webhook] Verification successful');
            return reply.code(200).send(challenge);
        }

        Logger.warn('[Meta Webhook] Verification failed', { mode, hasToken: !!token });
        return reply.code(403).send();
    });

    /**
     * POST /api/webhook/meta
     * Receives webhook events from Meta.
     */
    fastify.post('/', async (request, reply) => {
        try {
            const signature = request.headers['x-hub-signature-256'];
            const body = request.body as any;
            const rawBody = (request as any).rawBody as Buffer | undefined;

            Logger.info('[Meta Webhook] Event received', {
                object: body.object,
                entryCount: body.entry?.length,
            });

            if (typeof signature !== 'string' || !signature || !rawBody) {
                Logger.warn('[Meta Webhook] Missing signature or raw body');
                return reply.code(401).send();
            }

            const credentials = await prisma.platformCredentials.findUnique({
                where: { platform: 'META_MESSAGING' },
            });

            const appSecret = (credentials?.credentials as any)?.appSecret
                || process.env.META_APP_SECRET;

            if (!appSecret) {
                Logger.error('[Meta Webhook] App secret is not configured');
                return reply.code(503).send();
            }

            const isValid = MetaMessagingService.verifyWebhookSignature(
                signature,
                rawBody.toString('utf8'),
                appSecret
            );

            if (!isValid) {
                Logger.warn('[Meta Webhook] Invalid signature');
                return reply.code(403).send();
            }

            // Respond immediately - Meta expects 200 within 20 seconds
            reply.code(200).send();

            // Process events asynchronously
            if (body.object === 'page' || body.object === 'instagram') {
                await MetaMessagingService.processWebhookEvent(body.entry || []);
            }

        } catch (error: any) {
            Logger.error('[Meta Webhook] Processing error', { error: error.message });
            if (!reply.sent) return reply.code(503).send();
        }
    });
};

export default metaWebhookRoutes;
