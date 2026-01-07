/**
 * TikTok Webhook Routes
 * Handles incoming webhooks from TikTok Business Messaging.
 * 
 * Why: TikTok uses webhooks to deliver real-time message events.
 * Note: TikTok messaging is not available in EEA, Switzerland, or UK.
 */

import { Router, Request, Response } from 'express';
import { Logger } from '../utils/logger';
import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';
import { prisma } from '../utils/prisma';

const router = Router();

/**
 * GET /api/webhook/tiktok
 * Webhook verification endpoint.
 */
router.get('/', async (req: Request, res: Response) => {
    const challenge = req.query.challenge as string;

    Logger.info('[TikTok Webhook] Verification request', { hasChallenge: !!challenge });

    if (challenge) {
        // TikTok expects the challenge to be echoed back
        return res.status(200).send(challenge);
    }

    return res.sendStatus(200);
});

/**
 * POST /api/webhook/tiktok
 * Receives webhook events from TikTok (messages, etc.).
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const signature = req.headers['x-tiktok-signature'] as string;
        const timestamp = req.headers['x-tiktok-timestamp'] as string;
        const body = req.body;

        Logger.info('[TikTok Webhook] Event received', {
            event: body.event,
            hasSignature: !!signature,
        });

        // Verify signature if client secret is configured
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
                    return res.sendStatus(403);
                }
            }
        }

        // Respond immediately to acknowledge receipt
        res.sendStatus(200);

        // Process the event asynchronously
        if (body.event === 'message') {
            await TikTokMessagingService.processWebhookEvent(body);
        }

    } catch (error: any) {
        Logger.error('[TikTok Webhook] Processing error', { error: error.message });
        // Still return 200 to prevent TikTok from retrying
        res.sendStatus(200);
    }
});

export default router;
