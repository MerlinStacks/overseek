/**
 * Admin Route - Fastify Plugin
 * Super admin only routes for system management
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { requireAuthFastify, requireSuperAdminFastify } from '../middleware/auth';
import { generateToken } from '../utils/auth';
import { Logger } from '../utils/logger';

// Modular sub-routes (extracted for maintainability)
import { webhookAdminRoutes } from './admin/webhooks';
import { platformCredentialsRoutes } from './admin/platformCredentials';
import { geoipRoutes } from './admin/geoip';


/**
 * Formats uptime seconds into a human-readable string
 */
function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
}


const adminRoutes: FastifyPluginAsync = async (fastify) => {
    // Protect all admin routes
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', requireSuperAdminFastify);

    // Register modular sub-routes
    await fastify.register(webhookAdminRoutes);
    await fastify.register(platformCredentialsRoutes);
    await fastify.register(geoipRoutes);

    // Verify Admin Status
    fastify.get('/verify', async () => ({ isAdmin: true }));

    // =====================================================
    // SYSTEM HEALTH DIAGNOSTICS
    // =====================================================

    /**
     * GET /admin/system-health
     * Comprehensive system health overview for diagnostics
     */
    fastify.get('/system-health', async (request, reply) => {
        try {
            const { redisClient } = await import('../utils/redis');
            const { esClient } = await import('../utils/elastic');
            const { QueueFactory, QUEUES } = await import('../services/queue/QueueFactory');
            const { WebhookDeliveryService } = await import('../services/WebhookDeliveryService');

            // 1. Version Info
            const packageJson = require('../../package.json');
            const version = {
                app: packageJson.version || '0.0.0',
                node: process.version,
                uptime: Math.floor(process.uptime()),
                uptimeFormatted: formatUptime(process.uptime())
            };

            // 2. Service Health Checks
            const services: Record<string, { status: 'healthy' | 'degraded' | 'unhealthy'; latencyMs?: number; details?: string }> = {};

            // Database
            try {
                const dbStart = Date.now();
                await prisma.$queryRaw`SELECT 1`;
                services.database = { status: 'healthy', latencyMs: Date.now() - dbStart };
            } catch (e: any) {
                services.database = { status: 'unhealthy', details: e.message?.slice(0, 100) };
            }

            // Redis
            try {
                const redisStart = Date.now();
                await redisClient.ping();
                services.redis = { status: 'healthy', latencyMs: Date.now() - redisStart };
            } catch (e: any) {
                services.redis = { status: 'unhealthy', details: e.message?.slice(0, 100) };
            }

            // Elasticsearch
            try {
                const esStart = Date.now();
                const esHealth = await esClient.cluster.health();
                services.elasticsearch = {
                    status: esHealth.status === 'red' ? 'unhealthy' : esHealth.status === 'yellow' ? 'degraded' : 'healthy',
                    latencyMs: Date.now() - esStart,
                    details: `Cluster: ${esHealth.cluster_name}, Nodes: ${esHealth.number_of_nodes}`
                };
            } catch (e: any) {
                services.elasticsearch = { status: 'unhealthy', details: e.message?.slice(0, 100) };
            }

            // 3. Queue Statistics
            const queueStats: Record<string, { waiting: number; active: number; completed: number; failed: number }> = {};
            for (const [name, queueName] of Object.entries(QUEUES)) {
                try {
                    const queue = QueueFactory.getQueue(queueName);
                    const [waiting, active, completed, failed] = await Promise.all([
                        queue.getWaitingCount(),
                        queue.getActiveCount(),
                        queue.getCompletedCount(),
                        queue.getFailedCount()
                    ]);
                    queueStats[name.toLowerCase()] = { waiting, active, completed, failed };
                } catch (e) {
                    queueStats[name.toLowerCase()] = { waiting: -1, active: -1, completed: -1, failed: -1 };
                }
            }

            // Add scheduler queue
            try {
                const schedulerQueue = QueueFactory.getQueue('scheduler');
                const [waiting, active, completed, failed] = await Promise.all([
                    schedulerQueue.getWaitingCount(),
                    schedulerQueue.getActiveCount(),
                    schedulerQueue.getCompletedCount(),
                    schedulerQueue.getFailedCount()
                ]);
                queueStats.scheduler = { waiting, active, completed, failed };
            } catch (e) {
                queueStats.scheduler = { waiting: -1, active: -1, completed: -1, failed: -1 };
            }

            // 4. Sync States (last sync per entity type, aggregated)
            const syncStates = await prisma.syncState.findMany({
                include: { account: { select: { id: true, name: true } } },
                orderBy: { updatedAt: 'desc' },
                take: 50
            });

            const syncSummary = {
                totalAccounts: new Set(syncStates.map(s => s.accountId)).size,
                entityTypes: ['orders', 'products', 'customers', 'reviews'].map(entityType => {
                    const states = syncStates.filter(s => s.entityType === entityType);
                    const withSync = states.filter(s => s.lastSyncedAt);
                    const oldestSync = withSync.length > 0
                        ? Math.min(...withSync.map(s => s.lastSyncedAt!.getTime()))
                        : null;
                    const newestSync = withSync.length > 0
                        ? Math.max(...withSync.map(s => s.lastSyncedAt!.getTime()))
                        : null;
                    return {
                        type: entityType,
                        accountsTracked: states.length,
                        accountsSynced: withSync.length,
                        oldestSync: oldestSync ? new Date(oldestSync).toISOString() : null,
                        newestSync: newestSync ? new Date(newestSync).toISOString() : null
                    };
                })
            };

            // 5. Webhook Health
            let webhookHealth = { failed24h: 0, processed24h: 0, received24h: 0 };
            try {
                const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const [failed, processed, received] = await Promise.all([
                    prisma.webhookDelivery.count({ where: { status: 'FAILED', receivedAt: { gte: dayAgo } } }),
                    prisma.webhookDelivery.count({ where: { status: 'PROCESSED', receivedAt: { gte: dayAgo } } }),
                    prisma.webhookDelivery.count({ where: { receivedAt: { gte: dayAgo } } })
                ]);
                webhookHealth = { failed24h: failed, processed24h: processed, received24h: received };
            } catch (e) {
                // Table might not exist yet
            }

            // 6. Overall Status
            const allHealthy = Object.values(services).every(s => s.status === 'healthy');
            const anyUnhealthy = Object.values(services).some(s => s.status === 'unhealthy');

            return {
                status: anyUnhealthy ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded',
                timestamp: new Date().toISOString(),
                version,
                services,
                queues: queueStats,
                sync: syncSummary,
                webhooks: webhookHealth
            };
        } catch (e: any) {
            Logger.error('System health check failed', { error: e });
            return reply.code(500).send({ error: 'Health check failed', details: e.message });
        }
    });

    /**
     * GET /admin/sync-status
     * Detailed sync status per account for debugging
     */
    fastify.get('/sync-status', async (request, reply) => {
        try {
            const query = request.query as { accountId?: string; limit?: string };
            const limit = parseInt(query.limit || '20');

            const whereClause = query.accountId ? { accountId: query.accountId } : {};

            const [syncStates, syncLogs] = await Promise.all([
                prisma.syncState.findMany({
                    where: whereClause,
                    include: { account: { select: { id: true, name: true } } },
                    orderBy: { updatedAt: 'desc' },
                    take: limit * 4 // 4 entity types per account
                }),
                prisma.syncLog.findMany({
                    where: whereClause,
                    orderBy: { startedAt: 'desc' },
                    take: limit,
                    include: { account: { select: { id: true, name: true } } }
                })
            ]);

            // Group sync states by account
            const byAccount: Record<string, { account: { id: string; name: string }; states: any[]; recentLogs: any[] }> = {};

            for (const state of syncStates) {
                if (!byAccount[state.accountId]) {
                    byAccount[state.accountId] = {
                        account: { id: state.account.id, name: state.account.name },
                        states: [],
                        recentLogs: []
                    };
                }
                byAccount[state.accountId].states.push({
                    entityType: state.entityType,
                    lastSyncedAt: state.lastSyncedAt,
                    updatedAt: state.updatedAt
                });
            }

            for (const log of syncLogs) {
                if (byAccount[log.accountId]) {
                    byAccount[log.accountId].recentLogs.push({
                        entityType: log.entityType,
                        status: log.status,
                        itemsProcessed: log.itemsProcessed,
                        errorMessage: log.errorMessage,
                        startedAt: log.startedAt,
                        completedAt: log.completedAt
                    });
                }
            }

            return {
                accounts: Object.values(byAccount),
                total: Object.keys(byAccount).length
            };
        } catch (e: any) {
            Logger.error('Failed to fetch sync status', { error: e });
            return reply.code(500).send({ error: 'Failed to fetch sync status' });
        }
    });

    // System Stats
    fastify.get('/stats', async (request, reply) => {
        try {
            const [totalAccounts, totalUsers, activeSyncs, failedSyncs24h] = await Promise.all([
                prisma.account.count(),
                prisma.user.count(),
                prisma.syncLog.count({ where: { status: 'IN_PROGRESS' } }),
                prisma.syncLog.count({
                    where: {
                        status: 'FAILED',
                        startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                    }
                })
            ]);
            return { totalAccounts, totalUsers, activeSyncs, failedSyncs24h };
        } catch (e) {
            Logger.error('Admin stats error', { error: e });
            return reply.code(500).send({ error: 'Failed to fetch stats' });
        }
    });

    // List Accounts
    fastify.get('/accounts', async (request, reply) => {
        try {
            const accounts = await prisma.account.findMany({
                include: { _count: { select: { users: true } }, features: true },
                orderBy: { createdAt: 'desc' }
            });
            return accounts;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch accounts' });
        }
    });

    // Get Single Account
    fastify.get<{ Params: { accountId: string } }>('/accounts/:accountId', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                include: {
                    _count: { select: { users: true } },
                    features: true,
                    users: { include: { user: { select: { id: true, email: true, fullName: true } } } }
                }
            });
            if (!account) return reply.code(404).send({ error: 'Account not found' });
            return account;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch account' });
        }
    });

    // Delete Account
    fastify.delete<{ Params: { accountId: string }; Body: { confirmAccountName: string } }>('/accounts/:accountId', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { confirmAccountName } = request.body;

            if (!confirmAccountName) return reply.code(400).send({ error: 'confirmAccountName is required' });

            const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true, name: true } });
            if (!account) return reply.code(404).send({ error: 'Account not found' });
            if (account.name !== confirmAccountName) return reply.code(400).send({ error: 'Account name does not match. Deletion cancelled.' });

            await prisma.account.delete({ where: { id: accountId } });
            return { success: true, message: `Account "${account.name}" has been deleted.` };
        } catch (e: any) {
            Logger.error('Failed to delete account', { error: e });
            return reply.code(500).send({ error: 'Failed to delete account', details: e?.message });
        }
    });

    // Toggle Feature Flag
    fastify.post<{ Params: { accountId: string }; Body: { featureKey: string; isEnabled: boolean } }>('/accounts/:accountId/toggle-feature', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { featureKey, isEnabled } = request.body;
            const feature = await prisma.accountFeature.upsert({
                where: { accountId_featureKey: { accountId, featureKey } },
                update: { isEnabled },
                create: { accountId, featureKey, isEnabled }
            });
            return feature;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to toggle feature' });
        }
    });

    // System Logs
    fastify.get('/logs', async (request, reply) => {
        try {
            const query = request.query as { page?: string; limit?: string };
            const page = parseInt(query.page || '1');
            const limit = parseInt(query.limit || '20');
            const skip = (page - 1) * limit;

            const logs = await prisma.syncLog.findMany({
                orderBy: { startedAt: 'desc' },
                take: limit,
                skip,
                include: { account: { select: { name: true } } }
            });
            const total = await prisma.syncLog.count();
            return { logs, total, page, totalPages: Math.ceil(total / limit) };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch logs' });
        }
    });

    /**
     * DELETE /admin/sync-logs/failed
     * Clear all failed sync logs (admin maintenance)
     */
    fastify.delete('/sync-logs/failed', async (request, reply) => {
        try {
            const result = await prisma.syncLog.deleteMany({
                where: { status: 'FAILED' }
            });
            Logger.info('[Admin] Cleared failed sync logs', { count: result.count });
            return { success: true, deleted: result.count };
        } catch (e: any) {
            Logger.error('Failed to clear sync logs', { error: e });
            return reply.code(500).send({ error: 'Failed to clear sync logs' });
        }
    });

    // Impersonate User
    fastify.post<{ Body: { targetUserId: string } }>('/impersonate', async (request, reply) => {
        try {
            const { targetUserId } = request.body;
            const user = await prisma.user.findUnique({ where: { id: targetUserId } });
            if (!user) return reply.code(404).send({ error: 'User not found' });
            const token = generateToken({ userId: user.id });
            return { token, user: { id: user.id, email: user.email, fullName: user.fullName } };
        } catch (e) {
            return reply.code(500).send({ error: 'Impersonation failed' });
        }
    });

    // Broadcast Notification
    fastify.post<{ Body: { title: string; message: string; type?: string; link?: string; sendPush?: boolean } }>('/broadcast', async (request, reply) => {
        try {
            const { title, message, type, link, sendPush } = request.body;
            const accounts = await prisma.account.findMany({ select: { id: true } });
            await prisma.notification.createMany({
                data: accounts.map(acc => ({ accountId: acc.id, title, message, type: type || 'INFO', link }))
            });

            let pushResult = { sent: 0, failed: 0 };
            if (sendPush) {
                const { PushNotificationService } = await import('../services/PushNotificationService');
                pushResult = await PushNotificationService.sendBroadcast({
                    title,
                    body: message,
                    data: { url: link || '/dashboard', type: 'broadcast' }
                });
                Logger.info('[Admin] Broadcast with push', { accounts: accounts.length, ...pushResult });
            }

            return { success: true, count: accounts.length, pushSent: pushResult.sent, pushFailed: pushResult.failed };
        } catch (e) {
            return reply.code(500).send({ error: 'Broadcast failed' });
        }
    });

    // =====================================================
    // DIAGNOSTICS - Notification Debugging
    // =====================================================

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

            const { PushNotificationService } = await import('../services/PushNotificationService');

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
            // This helps when the admin is not subscribed to the specific account being tested
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

    // =====================================================
    // ACCOUNT BACKUP
    // =====================================================

    /**
     * GET /admin/accounts/:accountId/backup/preview
     * Get backup preview with record counts and estimated size
     */
    fastify.get<{ Params: { accountId: string } }>('/accounts/:accountId/backup/preview', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { AccountBackupService } = await import('../services/AccountBackupService');

            const preview = await AccountBackupService.getBackupPreview(accountId);
            if (!preview) {
                return reply.code(404).send({ error: 'Account not found' });
            }

            return preview;
        } catch (e: any) {
            Logger.error('[Admin] Backup preview failed', { error: e });
            return reply.code(500).send({ error: 'Failed to generate backup preview' });
        }
    });

    /**
     * POST /admin/accounts/:accountId/backup
     * Generate and download full account backup as JSON
     */
    fastify.post<{
        Params: { accountId: string };
        Body: { includeAuditLogs?: boolean; includeAnalytics?: boolean };
    }>('/accounts/:accountId/backup', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { includeAuditLogs, includeAnalytics } = request.body || {};
            const { AccountBackupService } = await import('../services/AccountBackupService');

            const backup = await AccountBackupService.generateBackup(accountId, {
                includeAuditLogs: Boolean(includeAuditLogs),
                includeAnalytics: Boolean(includeAnalytics),
            });

            if (!backup) {
                return reply.code(404).send({ error: 'Account not found' });
            }

            // Generate filename with account name and date
            const accountName = (backup.account as { name?: string }).name || 'account';
            const safeName = accountName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `${safeName}_backup_${dateStr}.json`;

            // Send as downloadable JSON file
            reply.header('Content-Type', 'application/json');
            reply.header('Content-Disposition', `attachment; filename="${filename}"`);

            return backup;
        } catch (e: any) {
            Logger.error('[Admin] Backup generation failed', { error: e });
            return reply.code(500).send({ error: 'Failed to generate backup', details: e.message });
        }
    });

    /**
     * POST /admin/accounts/:accountId/backup/save
     * Generate and save backup to storage (instead of downloading)
     */
    fastify.post<{
        Params: { accountId: string };
        Body: { includeAuditLogs?: boolean; includeAnalytics?: boolean };
    }>('/accounts/:accountId/backup/save', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { includeAuditLogs, includeAnalytics } = request.body || {};
            const { AccountBackupService } = await import('../services/AccountBackupService');

            const backup = await AccountBackupService.generateBackup(accountId, {
                includeAuditLogs: Boolean(includeAuditLogs),
                includeAnalytics: Boolean(includeAnalytics),
            });

            if (!backup) {
                return reply.code(404).send({ error: 'Account not found' });
            }

            // Save to storage
            const stored = await AccountBackupService.saveBackupToStorage(accountId, backup, 'MANUAL');

            // Apply retention policy
            await AccountBackupService.applyRetentionPolicy(accountId);

            return stored;
        } catch (e: any) {
            Logger.error('[Admin] Backup save failed', { error: e });
            return reply.code(500).send({ error: 'Failed to save backup', details: e.message });
        }
    });

    /**
     * GET /admin/accounts/:accountId/backup/settings
     * Get backup settings for an account
     */
    fastify.get<{ Params: { accountId: string } }>('/accounts/:accountId/backup/settings', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { AccountBackupService } = await import('../services/AccountBackupService');
            const settings = await AccountBackupService.getSettings(accountId);
            return settings;
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to get backup settings' });
        }
    });

    /**
     * PUT /admin/accounts/:accountId/backup/settings
     * Update backup settings for an account
     */
    fastify.put<{
        Params: { accountId: string };
        Body: { isEnabled?: boolean; frequency?: string; maxBackups?: number };
    }>('/accounts/:accountId/backup/settings', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { isEnabled, frequency, maxBackups } = request.body;
            const { AccountBackupService } = await import('../services/AccountBackupService');

            const settings = await AccountBackupService.updateSettings(accountId, {
                isEnabled,
                frequency: frequency as any,
                maxBackups,
            });

            Logger.info('[Admin] Backup settings updated', { accountId, settings });
            return settings;
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to update backup settings' });
        }
    });

    /**
     * GET /admin/accounts/:accountId/backups
     * List stored backups for an account
     */
    fastify.get<{ Params: { accountId: string } }>('/accounts/:accountId/backups', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { AccountBackupService } = await import('../services/AccountBackupService');
            const backups = await AccountBackupService.getStoredBackups(accountId);
            return backups;
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to get stored backups' });
        }
    });

    /**
     * GET /admin/backups/:backupId/download
     * Download a stored backup file
     */
    fastify.get<{ Params: { backupId: string } }>('/backups/:backupId/download', async (request, reply) => {
        try {
            const { backupId } = request.params;
            const { AccountBackupService } = await import('../services/AccountBackupService');
            const fs = await import('fs');

            const filePath = await AccountBackupService.getBackupFilePath(backupId);
            if (!filePath) {
                return reply.code(404).send({ error: 'Backup not found' });
            }

            const stream = fs.createReadStream(filePath);
            reply.header('Content-Type', 'application/gzip');
            reply.header('Content-Disposition', `attachment; filename="${filePath.split('/').pop() || 'backup.json.gz'}"`);
            return reply.send(stream);
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to download backup' });
        }
    });

    /**
     * DELETE /admin/backups/:backupId
     * Delete a stored backup
     */
    fastify.delete<{ Params: { backupId: string } }>('/backups/:backupId', async (request, reply) => {
        try {
            const { backupId } = request.params;
            const { AccountBackupService } = await import('../services/AccountBackupService');

            const success = await AccountBackupService.deleteStoredBackup(backupId);
            if (!success) {
                return reply.code(404).send({ error: 'Backup not found' });
            }

            return { success: true };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to delete backup' });
        }
    });

    /**
     * POST /admin/backups/:backupId/restore
     * Restore account data from a backup
     */
    fastify.post<{
        Params: { backupId: string };
        Body: { confirmAccountName: string };
    }>('/backups/:backupId/restore', async (request, reply) => {
        try {
            const { backupId } = request.params;
            const { confirmAccountName } = request.body;
            const { AccountBackupService } = await import('../services/AccountBackupService');

            // Get backup to verify account
            const backups = await prisma.storedBackup.findUnique({
                where: { id: backupId },
                include: { account: { select: { name: true } } },
            });

            if (!backups) {
                return reply.code(404).send({ error: 'Backup not found' });
            }

            // Verify account name matches
            if (backups.account.name !== confirmAccountName) {
                return reply.code(400).send({ error: 'Account name does not match' });
            }

            const result = await AccountBackupService.restoreFromBackup(backupId);

            if (!result.success) {
                return reply.code(500).send({ error: result.error || 'Restore failed' });
            }

            Logger.warn('[Admin] Account restored from backup', {
                backupId,
                accountId: backups.accountId,
                restoredTables: result.restoredTables,
            });

            return result;
        } catch (e: any) {
            Logger.error('[Admin] Restore failed', { error: e });
            return reply.code(500).send({ error: 'Failed to restore backup' });
        }
    });
};

export default adminRoutes;

