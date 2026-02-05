/**
 * Webhook Delivery Admin Routes
 * 
 * Handles webhook delivery management and replay functionality.
 * Extracted from admin.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify, requireSuperAdminFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';

export const webhookAdminRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', requireSuperAdminFastify);

    // List webhook deliveries
    fastify.get<{
        Querystring: {
            page?: string;
            limit?: string;
            status?: string;
            source?: string;
            accountId?: string;
        }
    }>('/webhooks', async (request, reply) => {
        try {
            const { page, limit, status, source, accountId } = request.query;
            const { WebhookDeliveryService } = await import('../../services/WebhookDeliveryService');

            const result = await WebhookDeliveryService.getDeliveries(
                accountId || null,
                {
                    status: status as 'RECEIVED' | 'PROCESSED' | 'FAILED',
                    source: source as 'WOOCOMMERCE' | 'META' | 'TIKTOK',
                },
                {
                    page: page ? parseInt(page) : 1,
                    limit: limit ? parseInt(limit) : 20,
                }
            );

            return result;
        } catch (e: any) {
            Logger.error('Failed to fetch webhook deliveries', { error: e });
            return reply.code(500).send({ error: 'Failed to fetch webhook deliveries' });
        }
    });

    // Get single webhook delivery with payload
    fastify.get<{ Params: { deliveryId: string } }>('/webhooks/:deliveryId', async (request, reply) => {
        try {
            const { deliveryId } = request.params;
            const { WebhookDeliveryService } = await import('../../services/WebhookDeliveryService');

            const delivery = await WebhookDeliveryService.getDelivery(deliveryId);
            if (!delivery) return reply.code(404).send({ error: 'Delivery not found' });

            return delivery;
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to fetch webhook delivery' });
        }
    });

    // Replay a failed webhook
    fastify.post<{ Params: { deliveryId: string } }>('/webhooks/:deliveryId/replay', async (request, reply) => {
        try {
            const { deliveryId } = request.params;
            const { WebhookDeliveryService } = await import('../../services/WebhookDeliveryService');
            const { processWebhookPayload } = await import('../webhook');

            const delivery = await WebhookDeliveryService.replay(deliveryId);
            if (!delivery) return reply.code(404).send({ error: 'Delivery not found' });

            // EDGE CASE: Check webhook staleness to prevent replaying severely outdated data
            const ageMs = Date.now() - new Date(delivery.receivedAt).getTime();
            const ageHours = ageMs / (1000 * 60 * 60);
            const MAX_REPLAY_AGE_HOURS = 24;
            const WARN_REPLAY_AGE_HOURS = 1;

            if (ageHours > MAX_REPLAY_AGE_HOURS) {
                Logger.warn('[WebhookReplay] Rejected stale webhook replay', {
                    deliveryId, ageHours: ageHours.toFixed(1), topic: delivery.topic
                });
                return reply.code(400).send({
                    error: 'Webhook too old to replay',
                    details: `Webhook is ${ageHours.toFixed(1)} hours old. Max replay age is ${MAX_REPLAY_AGE_HOURS} hours.`
                });
            }

            if (ageHours > WARN_REPLAY_AGE_HOURS) {
                Logger.warn('[WebhookReplay] Replaying stale webhook', {
                    deliveryId, ageHours: ageHours.toFixed(1), topic: delivery.topic
                });
            }

            try {
                await processWebhookPayload(
                    delivery.accountId,
                    delivery.topic,
                    delivery.payload as Record<string, unknown>
                );
                await WebhookDeliveryService.markProcessed(delivery.id);

                return {
                    success: true,
                    message: 'Webhook replayed successfully',
                    warning: ageHours > WARN_REPLAY_AGE_HOURS
                        ? `Webhook was ${ageHours.toFixed(1)} hours old - data may be stale`
                        : undefined
                };
            } catch (processError: any) {
                await WebhookDeliveryService.markFailed(delivery.id, processError.message || 'Replay failed');
                return reply.code(500).send({ error: 'Replay failed', details: processError.message });
            }
        } catch (e: any) {
            Logger.error('Failed to replay webhook', { error: e });
            return reply.code(500).send({ error: 'Failed to replay webhook' });
        }
    });

    // Get failed webhook count (for dashboard alerts)
    fastify.get('/webhooks/stats/failed', async (request, reply) => {
        try {
            const { WebhookDeliveryService } = await import('../../services/WebhookDeliveryService');
            const count = await WebhookDeliveryService.getFailedCount();
            return { failedCount24h: count };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to fetch stats' });
        }
    });
};
