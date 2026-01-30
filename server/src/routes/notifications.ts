/**
 * Notifications Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuthFastify } from '../middleware/auth';
import { PushNotificationService } from '../services/PushNotificationService';

interface SubscribeBody {
    subscription: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
    };
    preferences?: Record<string, boolean>;
}

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // GET / - List notifications for account
    fastify.get('/', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const query = request.query as { limit?: string };
            const limit = parseInt(query.limit || '20');

            const notifications = await prisma.notification.findMany({
                where: { accountId },
                orderBy: { createdAt: 'desc' },
                take: limit
            });

            const unreadCount = await prisma.notification.count({
                where: { accountId, isRead: false }
            });

            return { notifications, unreadCount };
        } catch (error) {
            Logger.error('Fetch notifications error', { error });
            return reply.code(500).send({ error: 'Failed to fetch notifications' });
        }
    });

    // POST /read-all - Mark all as read
    fastify.post('/read-all', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            await prisma.notification.updateMany({
                where: { accountId, isRead: false },
                data: { isRead: true }
            });

            return { success: true };
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to mark all read' });
        }
    });

    // POST /:id/read - Mark single as read
    fastify.post<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
        try {
            const { id } = request.params;
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            await prisma.notification.updateMany({
                where: { id, accountId },
                data: { isRead: true }
            });

            return { success: true };
        } catch (error) {
            return reply.code(500).send({ error: 'Failed' });
        }
    });

    // GET /vapid-public-key
    fastify.get('/vapid-public-key', async (request, reply) => {
        try {
            const publicKey = await PushNotificationService.getVapidPublicKey();
            if (!publicKey) {
                return reply.code(503).send({ error: 'Push notifications not configured' });
            }
            return { publicKey };
        } catch (error) {
            Logger.error('[notifications] Failed to get VAPID key', { error });
            return reply.code(500).send({ error: 'Failed to get VAPID key' });
        }
    });

    // GET /push/subscription
    fastify.get('/push/subscription', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const userId = request.user?.id;
            const { endpoint } = request.query as { endpoint?: string };

            if (!accountId || !userId) {
                return reply.code(400).send({ error: 'Account ID and user required' });
            }

            // Pass endpoint if provided for device-specific check
            const status = await PushNotificationService.getSubscription(userId, accountId, endpoint);
            return status;
        } catch (error) {
            Logger.error('[notifications] Failed to get subscription', { error });
            return reply.code(500).send({ error: 'Failed to get subscription status' });
        }
    });

    // POST /push/subscribe
    fastify.post<{ Body: SubscribeBody }>('/push/subscribe', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const userId = request.user?.id;
            Logger.warn('[notifications] Subscribe request received', { userId, accountId, hasBody: !!request.body });

            if (!accountId || !userId) {
                Logger.warn('[notifications] Subscribe missing IDs', { accountId, userId });
                return reply.code(400).send({ error: 'Account ID and user required' });
            }

            const { subscription, preferences } = request.body;
            if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
                Logger.warn('[notifications] Invalid subscription format', { subscription });
                return reply.code(400).send({ error: 'Invalid subscription format' });
            }

            Logger.warn('[notifications] Calling PushNotificationService.subscribe', {
                userId,
                accountId,
                endpoint: subscription.endpoint.substring(0, 50) + '...',
                hasP256dh: !!subscription.keys.p256dh,
                hasAuth: !!subscription.keys.auth
            });

            const result = await PushNotificationService.subscribe(userId, accountId, subscription, preferences);
            Logger.warn('[notifications] Subscribe result', { result });

            if (!result.success) {
                return reply.code(500).send({ error: result.error });
            }

            return { success: true, id: result.id };
        } catch (error) {
            Logger.error('[notifications] Subscribe failed', { error });
            return reply.code(500).send({ error: 'Failed to subscribe' });
        }
    });

    // DELETE /push/subscribe
    fastify.delete<{ Body: { endpoint: string } }>('/push/subscribe', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(400).send({ error: 'User required' });
            }

            const { endpoint } = request.body;
            if (!endpoint) {
                return reply.code(400).send({ error: 'Endpoint required' });
            }

            const success = await PushNotificationService.unsubscribe(userId, endpoint);
            return { success };
        } catch (error) {
            Logger.error('[notifications] Unsubscribe failed', { error });
            return reply.code(500).send({ error: 'Failed to unsubscribe' });
        }
    });

    // PATCH /push/preferences
    fastify.patch<{ Body: { endpoint: string; preferences: Record<string, boolean> } }>('/push/preferences', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(400).send({ error: 'User required' });
            }

            const { endpoint, preferences } = request.body;
            if (!endpoint) {
                return reply.code(400).send({ error: 'Endpoint required' });
            }

            const success = await PushNotificationService.updatePreferences(userId, endpoint, preferences);
            return { success };
        } catch (error) {
            Logger.error('[notifications] Update preferences failed', { error });
            return reply.code(500).send({ error: 'Failed to update preferences' });
        }
    });

    // POST /push/test
    fastify.post('/push/test', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const userId = request.user?.id;
            Logger.warn('[notifications] Test notification request', { userId, accountId });

            if (!accountId || !userId) {
                Logger.warn('[notifications] Test missing IDs', { accountId, userId });
                return reply.code(400).send({ error: 'Account ID and user required' });
            }

            const result = await PushNotificationService.sendTestNotification(userId, accountId);
            Logger.warn('[notifications] Test notification result', { result });

            if (!result.success) {
                return reply.code(400).send({ error: result.error || 'Failed to send test notification' });
            }

            return { success: true, sent: result.sent, failed: result.failed };
        } catch (error) {
            Logger.error('[notifications] Test notification failed', { error });
            return reply.code(500).send({ error: 'Failed to send test notification' });
        }
    });

    // POST /push/test-order - Test order notification specifically
    fastify.post('/push/test-order', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const userId = request.user?.id;
            Logger.info('[notifications] Test ORDER notification request', { userId, accountId });

            if (!accountId || !userId) {
                return reply.code(400).send({ error: 'Account ID and user required' });
            }

            // Create a mock order notification
            const mockOrderNumber = Math.floor(1000 + Math.random() * 9000);
            const mockTotal = (Math.random() * 200 + 20).toFixed(2);
            const mockName = ['John Smith', 'Emma Wilson', 'Michael Brown', 'Sarah Davis'][Math.floor(Math.random() * 4)];

            const result = await PushNotificationService.sendToAccount(
                accountId,
                {
                    title: `🛒 New Order #${mockOrderNumber}`,
                    body: `${mockName} placed an order for $${mockTotal}`,
                    data: {
                        type: 'order',
                        orderId: mockOrderNumber.toString(),
                        url: `/m/orders/${mockOrderNumber}`
                    }
                },
                'order'
            );

            Logger.info('[notifications] Test order notification result', { result });

            // Return helpful message if no notifications sent
            if (result.sent === 0) {
                return {
                    success: false,
                    sent: 0,
                    failed: result.failed,
                    orderNumber: mockOrderNumber,
                    message: 'No devices with push enabled for orders. Try disabling and re-enabling push notifications.'
                };
            }

            return {
                success: true,
                sent: result.sent,
                failed: result.failed,
                orderNumber: mockOrderNumber
            };
        } catch (error) {
            Logger.error('[notifications] Test order notification failed', { error });
            return reply.code(500).send({ error: 'Failed to send test order notification' });
        }
    });

};


export default notificationsRoutes;
