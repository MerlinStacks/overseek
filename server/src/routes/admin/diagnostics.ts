/**
 * Admin Diagnostics Routes
 * 
 * Push notification debugging and diagnostic endpoints.
 * Extracted from admin.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export const diagnosticsRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /admin/diagnostics/push-subscriptions
     * List all push subscriptions across all accounts for debugging
     */
    fastify.get('/diagnostics/push-subscriptions', async (request, reply) => {
        try {
            const subscriptions = await prisma.pushSubscription.findMany({
                include: {
                    user: { select: { id: true, email: true, fullName: true } },
                    account: { select: { id: true, name: true } }
                },
                orderBy: { updatedAt: 'desc' },
                take: 100
            });

            // Group by account for easier reading
            const byAccount: Record<string, any[]> = {};
            for (const sub of subscriptions) {
                const key = `${sub.account.name} (${sub.accountId.slice(0, 8)}...)`;
                if (!byAccount[key]) byAccount[key] = [];
                byAccount[key].push({
                    id: sub.id.slice(0, 8),
                    userId: sub.userId.slice(0, 8),
                    userEmail: sub.user.email,
                    userName: sub.user.fullName,
                    accountId: sub.accountId,
                    accountName: sub.account.name,
                    notifyOrders: sub.notifyNewOrders,
                    notifyMessages: sub.notifyNewMessages,
                    endpointShort: sub.endpoint.slice(0, 60) + '...',
                    updatedAt: sub.updatedAt
                });
            }

            return {
                totalSubscriptions: subscriptions.length,
                uniqueAccounts: Object.keys(byAccount).length,
                byAccount
            };
        } catch (e: any) {
            Logger.error('[Admin] Failed to fetch push subscriptions', { error: e });
            return reply.code(500).send({ error: 'Failed to fetch push subscriptions' });
        }
    });

    /**
     * GET /admin/diagnostics/notification-deliveries
     * Get recent notification delivery logs with full diagnostics
     */
    fastify.get('/diagnostics/notification-deliveries', async (request, reply) => {
        try {
            const query = request.query as { limit?: string };
            const limit = parseInt(query.limit || '50');

            const deliveries = await prisma.notificationDelivery.findMany({
                orderBy: { createdAt: 'desc' },
                take: limit,
                include: {
                    account: { select: { id: true, name: true } }
                }
            });

            return {
                total: deliveries.length,
                deliveries: deliveries.map(d => ({
                    id: d.id.slice(0, 8),
                    accountId: d.accountId,
                    accountName: d.account.name,
                    eventType: d.eventType,
                    channels: d.channels,
                    results: d.results,
                    subscriptionLookup: d.subscriptionLookup,
                    payload: d.payload,
                    createdAt: d.createdAt
                }))
            };
        } catch (e: any) {
            Logger.error('[Admin] Failed to fetch notification deliveries', { error: e });
            return reply.code(500).send({ error: 'Failed to fetch notification deliveries' });
        }
    });

    /**
     * POST /admin/diagnostics/test-push/:accountId
     * Send a test push notification to a specific account to verify delivery
     */
    fastify.post<{ Params: { accountId: string }; Body: { type?: 'order' | 'message' } }>('/diagnostics/test-push/:accountId', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const type = request.body?.type || 'order';

            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { id: true, name: true }
            });
            if (!account) return reply.code(404).send({ error: 'Account not found' });

            const { PushNotificationService } = await import('../../services/PushNotificationService');

            const notification = {
                title: '🔧 Admin Test',
                body: `Test ${type} notification for ${account.name}`,
                data: { type: 'admin_test', timestamp: Date.now() }
            };

            const result = await PushNotificationService.sendToAccount(
                accountId,
                notification,
                type
            );

            // Also send to the admin (current user) so they can verify it works
            const adminId = request.user?.id;
            let adminResult = { sent: 0, failed: 0 };
            if (adminId) {
                adminResult = await PushNotificationService.sendToUser(adminId, notification);
            }

            // Also get current subscriptions for this account
            const whereClause: any = { accountId };
            if (type === 'order') whereClause.notifyNewOrders = true;
            if (type === 'message') whereClause.notifyNewMessages = true;

            const subscriptions = await prisma.pushSubscription.findMany({
                where: whereClause,
                select: { id: true, userId: true, endpoint: true }
            });

            return {
                success: result.sent > 0 || adminResult.sent > 0,
                accountId,
                accountName: account.name,
                sent: result.sent,
                failed: result.failed,
                adminSent: adminResult.sent,
                eligibleSubscriptions: subscriptions.length,
                subscriptionIds: subscriptions.map(s => ({
                    id: s.id.slice(0, 8),
                    userId: s.userId.slice(0, 8),
                    endpointShort: s.endpoint.slice(0, 50) + '...'
                }))
            };
        } catch (e: any) {
            Logger.error('[Admin] Test push failed', { error: e });
            return reply.code(500).send({ error: 'Test push failed', details: e.message });
        }
    });

    /**
     * DELETE /admin/diagnostics/push-subscriptions/:subscriptionId
     * Delete a specific push subscription (for cleanup)
     */
    fastify.delete<{ Params: { subscriptionId: string } }>('/diagnostics/push-subscriptions/:subscriptionId', async (request, reply) => {
        try {
            const { subscriptionId } = request.params;
            await prisma.pushSubscription.delete({ where: { id: subscriptionId } });
            return { success: true, message: 'Subscription deleted' };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to delete subscription' });
        }
    });

    /**
     * DELETE /admin/diagnostics/push-subscriptions
     * Delete ALL push subscriptions (nuclear option for cleanup)
     */
    fastify.delete('/diagnostics/push-subscriptions', async (request, reply) => {
        try {
            const result = await prisma.pushSubscription.deleteMany();
            Logger.warn('[Admin] Deleted all push subscriptions', { count: result.count });
            return { success: true, deleted: result.count };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to delete subscriptions' });
        }
    });
};
