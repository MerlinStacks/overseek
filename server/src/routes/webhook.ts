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
import { EventBus, EVENTS } from '../services/events';

/** Verify WooCommerce HMAC signature */
const verifySignature = (
    payload: unknown,
    signature: string,
    secret: string,
    rawBody?: Buffer | string
): boolean => {
    const bodyBuffer = rawBody !== undefined
        ? (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
        : Buffer.from(JSON.stringify(payload), 'utf8');

    const hash = crypto.createHmac('sha256', secret)
        .update(bodyBuffer)
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
        // Save to database immediately to prevent duplicate notifications from Sync Engine
        // (Sync Engine checks if order exists in DB to determine if it's "new")
        try {
            const order = body as any;
            const rawEmail = order.billing?.email;
            const billingEmail = rawEmail && rawEmail.trim() ? rawEmail.toLowerCase().trim() : null;
            const billingCountry = order.billing?.country || null;
            const wooCustomerId = order.customer_id > 0 ? order.customer_id : null;

            await prisma.wooOrder.upsert({
                where: { accountId_wooId: { accountId, wooId: order.id } },
                update: {
                    status: order.status.toLowerCase(),
                    total: order.total === '' ? '0' : order.total,
                    currency: order.currency,
                    billingEmail,
                    billingCountry,
                    wooCustomerId,
                    dateModified: new Date(order.date_modified || new Date()),
                    rawData: order
                },
                create: {
                    accountId,
                    wooId: order.id,
                    number: order.number,
                    status: order.status.toLowerCase(),
                    total: order.total === '' ? '0' : order.total,
                    currency: order.currency,
                    billingEmail,
                    billingCountry,
                    wooCustomerId,
                    dateCreated: new Date(order.date_created || new Date()),
                    dateModified: new Date(order.date_modified || new Date()),
                    rawData: order
                }
            });
        } catch (error) {
            Logger.error('[Webhook] Failed to save order to DB', { accountId, orderId: body.id, error });
        }

        await IndexingService.indexOrder(accountId, body);

        if (topic === 'order.created') {
            Logger.info(`[Webhook] New order received via webhook`, {
                accountId,
                orderId: body.id,
                orderNumber: body.number,
                total: body.total
            });

            // Emit event - NotificationEngine handles in-app, push, and socket
            EventBus.emit(EVENTS.ORDER.CREATED, { accountId, order: body });
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
    // WooCommerce may send webhooks with non-standard content types.
    // Capture the raw body for signature verification and parse JSON if possible.
    fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) => {
        const rawBody = body as Buffer;
        (req as any).rawBody = rawBody;

        const text = rawBody.toString('utf8');
        try {
            const json = JSON.parse(text);
            done(null, json);
        } catch {
            // If it's not JSON, just pass the raw string
            done(null, text);
        }
    });

    // Webhook Endpoint - no auth required (uses signature verification)
    fastify.post<{ Params: { accountId: string } }>('/:accountId', async (request, reply) => {
        const { accountId } = request.params;
        const signature = request.headers['x-wc-webhook-signature'] as string;
        const topic = request.headers['x-wc-webhook-topic'] as string;
        const body = request.body as Record<string, unknown> | string;
        const rawBody = (request as any).rawBody as Buffer | undefined;

        // WooCommerce sends a ping request to verify the URL when creating a webhook
        // These requests may not have the signature/topic headers
        if (!signature || !topic) {
            // Check if this looks like a valid WooCommerce order payload (has 'id' and 'order_key' or 'number')
            const looksLikeOrder = body && typeof body === 'object' && (body.id || body.order_key || body.number);

            // If it doesn't look like a real order, treat as ping/verification
            if (!looksLikeOrder) {
                Logger.info('[Webhook] Received WooCommerce ping/verification request', { accountId });
                return reply.code(200).send('Webhook URL verified');
            }

            // Has order-like data but no signature - reject
            Logger.warn('[Webhook] Missing required headers for order webhook', {
                accountId,
                hasSignature: !!signature,
                hasTopic: !!topic,
                bodyKeys: body ? Object.keys(body).slice(0, 10) : []
            });
            return reply.code(400).send('Missing headers');
        }

        // Lookup account
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (!account) {
            return reply.code(404).send('Account not found');
        }

        if (typeof body !== 'object' || body === null) {
            Logger.warn('[Webhook] Invalid payload format', { accountId, topic });
            return reply.code(400).send('Invalid payload');
        }

        // Verify signature
        const secret = account.webhookSecret || account.wooConsumerSecret;
        if (!secret) {
            Logger.warn(`No credentials to verify webhook`, { accountId });
            return reply.code(401).send('No Webhook Secret Configured');
        }

        if (!verifySignature(body, signature, secret, rawBody)) {
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
