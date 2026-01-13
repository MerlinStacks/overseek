/**
 * Webhook Route - Fastify Plugin
 * Handles WooCommerce webhooks with delivery logging for replay
 */

import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { IndexingService } from '../services/search/IndexingService';
import { WebhookDeliveryService } from '../services/WebhookDeliveryService';
import { io } from '../app';

/** Verify WooCommerce HMAC signature */
const verifySignature = (payload: unknown, signature: string, secret: string): boolean => {
    const hash = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('base64');

    try {
        const hashBuffer = Buffer.from(hash, 'utf8');
        const sigBuffer = Buffer.from(signature, 'utf8');
        if (hashBuffer.length !== sigBuffer.length) {
            return false;
        }
        return crypto.timingSafeEqual(hashBuffer, sigBuffer);
    } catch {
        return false;
    }
};

/**
 * Process a webhook payload (used for both live and replay).
 * Exported for use by admin replay endpoint.
 */
export async function processWebhookPayload(
    accountId: string,
    topic: string,
    body: Record<string, unknown>
): Promise<void> {
    // Handle Order Events
    if (topic === 'order.created' || topic === 'order.updated') {
        await IndexingService.indexOrder(accountId, body);

        if (topic === 'order.created') {
            Logger.info(`[Webhook] New order received via webhook`, {
                accountId,
                orderId: body.id,
                orderNumber: body.number,
                total: body.total
            });

            await prisma.notification.create({
                data: {
                    accountId,
                    title: 'New Order Received',
                    message: `Order #${body.number || body.id} has been placed.`,
                    type: 'SUCCESS',
                    link: '/orders'
                }
            });

            // Emit socket event
            Logger.warn(`[Webhook] Emitting order:new to room account:${accountId}`, {
                orderId: body.id,
                orderNumber: body.number || body.id,
                total: body.total
            });
            io.to(`account:${accountId}`).emit('order:new', {
                orderId: body.id,
                orderNumber: body.number || body.id,
                total: body.total,
                customerName: (body.billing as Record<string, string>)?.first_name
                    ? `${(body.billing as Record<string, string>).first_name} ${(body.billing as Record<string, string>).last_name || ''}`.trim()
                    : 'Guest'
            });

            // Send push notification
            const { PushNotificationService } = require('../services/PushNotificationService');
            await PushNotificationService.sendToAccount(accountId, {
                title: '🛒 New Order!',
                body: `Order #${body.number || body.id} - $${body.total}`,
                data: { url: '/orders' }
            }, 'order');
        }
        Logger.info(`Indexed Order`, { orderId: body.id, accountId });
    }

    // Handle Product Events
    if (topic === 'product.created' || topic === 'product.updated') {
        await IndexingService.indexProduct(accountId, body);
        Logger.info(`Indexed Product`, { productId: body.id, accountId });
    }

    // Handle Customer Events
    if (topic === 'customer.created' || topic === 'customer.updated') {
        await IndexingService.indexCustomer(accountId, body);
        Logger.info(`Indexed Customer`, { customerId: body.id, accountId });
    }
}

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
    // WooCommerce may send webhooks with non-standard content types
    // Add parser to handle text/plain and other variations
    fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
        try {
            const json = JSON.parse(body as string);
            done(null, json);
        } catch (err) {
            done(err as Error, undefined);
        }
    });

    // Also handle cases where content-type might be missing or unusual
    fastify.addContentTypeParser('*', { parseAs: 'string' }, (req, body, done) => {
        try {
            const json = JSON.parse(body as string);
            done(null, json);
        } catch (err) {
            // If it's not JSON, just pass the raw string
            done(null, body);
        }
    });

    // Webhook Endpoint - no auth required (uses signature verification)
    fastify.post<{ Params: { accountId: string } }>('/:accountId', async (request, reply) => {
        const { accountId } = request.params;
        const signature = request.headers['x-wc-webhook-signature'] as string;
        const topic = request.headers['x-wc-webhook-topic'] as string;
        const body = request.body as Record<string, unknown>;

        // Validate required headers
        if (!signature || !topic) {
            return reply.code(400).send('Missing headers');
        }

        // Lookup account
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (!account) {
            return reply.code(404).send('Account not found');
        }

        // Verify signature
        const secret = account.webhookSecret || account.wooConsumerSecret;
        if (!secret) {
            Logger.warn(`No credentials to verify webhook`, { accountId });
            return reply.code(401).send('No Webhook Secret Configured');
        }

        if (!verifySignature(body, signature, secret)) {
            Logger.warn(`Invalid Webhook Signature`, { accountId });
            return reply.code(401).send('Invalid Signature');
        }

        // Log delivery BEFORE processing
        let deliveryId: string | null = null;
        try {
            deliveryId = await WebhookDeliveryService.logDelivery(
                accountId,
                topic,
                body,
                'WOOCOMMERCE'
            );
        } catch (logError) {
            // Don't block webhook processing if logging fails
            Logger.error('[Webhook] Failed to log delivery', { accountId, topic, error: logError });
        }

        // Process the webhook
        try {
            await processWebhookPayload(accountId, topic, body);

            // Mark as processed
            if (deliveryId) {
                await WebhookDeliveryService.markProcessed(deliveryId);
            }

            return reply.code(200).send('Webhook received');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            Logger.error('Webhook processing error', { accountId, topic, error });

            // Mark as failed with error details
            if (deliveryId) {
                await WebhookDeliveryService.markFailed(deliveryId, errorMessage);
            }

            return reply.code(500).send('Server Error');
        }
    });
};

export default webhookRoutes;
