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
            const signature = request.headers['x-tiktok-signature'] as string;
            const timestamp = request.headers['x-tiktok-timestamp'] as string;
            const body = request.body as any;

            Logger.info('[TikTok Webhook] Event received', {
                event: body.event,
                hasSignature: !!signature,
            });

            if (signature && timestamp) {
                const credentials = await prisma.platformCredentials.findUnique({
                    where: { platform: 'TIKTOK_MESSAGING' },
                });

                const clientSecret = credentials?.credentials
                    ? (credentials.credentials as any).clientSecret
                    : process.env.TIKTOK_CLIENT_SECRET;

                if (clientSecret) {
                    const rawBody = JSON.stringify(body);
                    const isValid = TikTokMessagingService.verifyWebhookSignature(
                        signature,
                        timestamp,
                        rawBody,
                        clientSecret
                    );

                    if (!isValid) {
                        Logger.warn('[TikTok Webhook] Invalid signature');
                        return reply.code(403).send();
                    }
                }
            }

            reply.code(200).send();

            if (body.event === 'message') {
                await TikTokMessagingService.processWebhookEvent(body);
            }

        } catch (error: any) {
            Logger.error('[TikTok Webhook] Processing error', { error: error.message });
            return reply.code(200).send();
        }
    });
};

export default tiktokWebhookRoutes;
