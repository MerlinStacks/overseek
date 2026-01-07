/**
 * Meta Webhook Routes
 * Handles incoming webhooks from Facebook Messenger and Instagram DMs.
 * 
 * Why: Meta uses webhooks to deliver real-time message events.
 * This endpoint receives and processes those events.
 */

import { Router, Request, Response } from 'express';
import { Logger } from '../utils/logger';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';
import { prisma } from '../utils/prisma';

const router = Router();

/**
 * GET /api/webhook/meta
 * Webhook verification endpoint.
 * Meta sends a GET request with a challenge to verify the webhook URL.
 */
router.get('/', async (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    Logger.info('[Meta Webhook] Verification request', { mode, hasToken: !!token });

    // Get the verify token from platform credentials
    const credentials = await prisma.platformCredentials.findUnique({
        where: { platform: 'META_MESSAGING' },
    });

    const expectedToken = credentials?.credentials
        ? (credentials.credentials as any).webhookVerifyToken
        : process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === expectedToken) {
        Logger.info('[Meta Webhook] Verification successful');
        return res.status(200).send(challenge);
    }

    Logger.warn('[Meta Webhook] Verification failed', { mode, token });
    return res.sendStatus(403);
});

/**
 * POST /api/webhook/meta
 * Receives webhook events from Meta (messages, read receipts, etc.).
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const signature = req.headers['x-hub-signature-256'] as string;
        const body = req.body;

        Logger.info('[Meta Webhook] Event received', {
            object: body.object,
            entryCount: body.entry?.length,
        });

        // Verify signature if app secret is configured
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
                    return res.sendStatus(403);
                }
            }
        }

        // Respond immediately to acknowledge receipt
        // Meta expects a 200 response within 20 seconds
        res.sendStatus(200);

        // Process events asynchronously
        if (body.object === 'page' || body.object === 'instagram') {
            await MetaMessagingService.processWebhookEvent(body.entry || []);
        }

    } catch (error: any) {
        Logger.error('[Meta Webhook] Processing error', { error: error.message });
        // Still return 200 to prevent Meta from retrying
        res.sendStatus(200);
    }
});

export default router;
