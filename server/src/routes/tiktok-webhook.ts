/**
 * TikTok Webhook Routes - Fastify Plugin
 * Handles incoming webhooks from TikTok Business Messaging.
 * 
 * EDGE CASE FIX: TikTok Webhook Signature Verification
 * =====================================================
 * TikTok uses a DIFFERENT signature algorithm than WooCommerce:
 * 
 * TikTok Algorithm (HMAC-SHA256):
 *   1. Concatenate: timestamp + raw_body
 *   2. Sign with HMAC-SHA256 using client_secret as key
 *   3. Compare signature header via timing-safe comparison
 * 
 * Headers:
 *   - x-tiktok-signature: HMAC-SHA256 hex digest
 *   - x-tiktok-timestamp: Unix timestamp string
 * 
 * WooCommerce Algorithm (HMAC-SHA256):
 *   1. Use raw_body only (no timestamp concat)
 *   2. Sign with HMAC-SHA256 using webhook_secret as key
 *   3. Compare Base64-encoded signature
 * 
 * KEY DIFFERENCES:
 *   - TikTok prepends timestamp to payload before hashing
 *   - TikTok uses hex encoding vs WooCommerce base64
 *   - TikTok gets secret from OAuth client; WooCommerce from webhook config
 * 
 * @see TikTokMessagingService.verifyWebhookSignature for implementation
 */

import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../utils/logger';
import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';
import { prisma } from '../utils/prisma';

const tiktokWebhookRoutes: FastifyPluginAsync = async (fastify) => {
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
     * GET /api/webhook/tiktok
     * Webhook verification endpoint.
     */
    fastify.get('/', async (request, reply) => {
        const query = request.query as { challenge?: string };
        const challenge = query.challenge;

        Logger.info('[TikTok Webhook] Verification request', { hasChallenge: !!challenge });

        if (challenge) {
            return reply.code(200).send(challenge);
        }

        return reply.code(200).send();
    });

    /**
     * POST /api/webhook/tiktok
     * Receives webhook events from TikTok.
     */
    fastify.post('/', async (request, reply) => {
        try {
            const signature = request.headers['x-tiktok-signature'];
            const timestamp = request.headers['x-tiktok-timestamp'];
            const body = request.body as any;
            const rawBody = (request as any).rawBody as Buffer | undefined;

            Logger.info('[TikTok Webhook] Event received', {
                event: body.event,
                hasSignature: !!signature,
            });

            if (typeof signature !== 'string' || !signature || typeof timestamp !== 'string' || !timestamp || !rawBody) {
                Logger.warn('[TikTok Webhook] Missing signature, timestamp, or raw body');
                return reply.code(401).send();
            }

            const credentials = await prisma.platformCredentials.findUnique({
                where: { platform: 'TIKTOK_MESSAGING' },
            });

            const clientSecret = (credentials?.credentials as any)?.clientSecret
                || process.env.TIKTOK_CLIENT_SECRET;

            if (!clientSecret) {
                Logger.error('[TikTok Webhook] Client secret is not configured');
                return reply.code(503).send();
            }

            const isValid = TikTokMessagingService.verifyWebhookSignature(
                signature,
                timestamp,
                rawBody.toString('utf8'),
                clientSecret
            );

            if (!isValid) {
                Logger.warn('[TikTok Webhook] Invalid signature');
                return reply.code(403).send();
            }

            reply.code(200).send();

            if (body.event === 'message') {
                await TikTokMessagingService.processWebhookEvent(body);
            }

        } catch (error: any) {
            Logger.error('[TikTok Webhook] Processing error', { error: error.message });
            if (!reply.sent) return reply.code(503).send();
        }
    });
};

export default tiktokWebhookRoutes;
