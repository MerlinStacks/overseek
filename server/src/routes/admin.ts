/**
 * Admin Route - Fastify Plugin
 * Super admin only routes for system management
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { requireAuthFastify, requireSuperAdminFastify } from '../middleware/auth';
import { generateToken } from '../utils/auth';
import { Logger } from '../utils/logger';
import { platformEmailService } from '../services/PlatformEmailService';
import webpush from 'web-push';
import path from 'path';
import fs from 'fs';
import { initGeoIP } from '../services/tracking/GeoIPService';

function maskCredentials(creds: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(creds)) {
        if (typeof value === 'string' && value.length > 4) {
            masked[key] = value.substring(0, 4) + '********';
        } else {
            masked[key] = '********';
        }
    }
    return masked;
}

const adminRoutes: FastifyPluginAsync = async (fastify) => {
    // Protect all admin routes
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', requireSuperAdminFastify);

    // Verify Admin Status
    fastify.get('/verify', async () => ({ isAdmin: true }));

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

    // Platform Credentials - List
    fastify.get('/platform-credentials', async (request, reply) => {
        try {
            const credentials = await prisma.platformCredentials.findMany({ orderBy: { platform: 'asc' } });
            return credentials;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch platform credentials' });
        }
    });

    // Platform Credentials - Get One
    fastify.get<{ Params: { platform: string } }>('/platform-credentials/:platform', async (request, reply) => {
        try {
            const { platform } = request.params;
            const cred = await prisma.platformCredentials.findUnique({ where: { platform } });
            if (!cred) return reply.code(404).send({ error: 'Platform credentials not found' });
            return { ...cred, credentials: maskCredentials(cred.credentials as Record<string, string>) };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch platform credentials' });
        }
    });

    // Platform Credentials - Upsert
    fastify.put<{ Params: { platform: string }; Body: { credentials: Record<string, any>; notes?: string } }>('/platform-credentials/:platform', async (request, reply) => {
        try {
            const { platform } = request.params;
            const { credentials, notes } = request.body;
            if (!credentials || typeof credentials !== 'object') return reply.code(400).send({ error: 'Invalid credentials format' });
            const cred = await prisma.platformCredentials.upsert({
                where: { platform },
                update: { credentials, notes },
                create: { platform, credentials, notes }
            });
            return { ...cred, credentials: maskCredentials(cred.credentials as Record<string, string>) };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to save platform credentials' });
        }
    });

    // Platform Credentials - Delete
    fastify.delete<{ Params: { platform: string } }>('/platform-credentials/:platform', async (request, reply) => {
        try {
            const { platform } = request.params;
            await prisma.platformCredentials.delete({ where: { platform } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to delete platform credentials' });
        }
    });

    // Platform SMTP Test
    fastify.post<{ Body: { host: string; port: string | number; username: string; password: string; secure?: boolean } }>('/platform-smtp/test', async (request, reply) => {
        try {
            const { host, port, username, password, secure } = request.body;
            if (!host || !port || !username || !password) {
                return reply.code(400).send({ success: false, error: 'Missing required fields' });
            }
            const result = await platformEmailService.testConnection({ host, port: parseInt(String(port)), username, password, secure: Boolean(secure) });
            if (result.success) return { success: true };
            return reply.code(400).send({ success: false, error: result.error });
        } catch (e: any) {
            return reply.code(500).send({ success: false, error: e.message || 'SMTP test failed' });
        }
    });

    // Generate VAPID Keys and save to database
    fastify.post('/generate-vapid-keys', async (request, reply) => {
        try {
            // Check if keys already exist
            const existing = await prisma.platformCredentials.findUnique({
                where: { platform: 'WEB_PUSH_VAPID' }
            });

            if (existing) {
                const existingKeys = existing.credentials as { publicKey: string; privateKey: string };
                Logger.warn('[Admin] VAPID keys already exist, returning existing public key');
                return {
                    publicKey: existingKeys.publicKey,
                    alreadyExists: true,
                    message: 'VAPID keys already configured. Delete existing keys first to regenerate.'
                };
            }

            // Generate new keys
            const keys = webpush.generateVAPIDKeys();

            // Save to database
            await prisma.platformCredentials.create({
                data: {
                    platform: 'WEB_PUSH_VAPID',
                    credentials: {
                        publicKey: keys.publicKey,
                        privateKey: keys.privateKey
                    },
                    notes: `Generated via Admin UI on ${new Date().toISOString()}`
                }
            });

            Logger.warn('[Admin] Generated and saved new VAPID keys');
            return {
                publicKey: keys.publicKey,
                alreadyExists: false,
                message: 'VAPID keys generated and saved successfully!'
            };
        } catch (e: any) {
            Logger.error('[Admin] Failed to generate VAPID keys', { error: e });
            return reply.code(500).send({ error: e.message || 'Failed to generate VAPID keys' });
        }
    });

    // AI Prompts - List
    fastify.get('/ai-prompts', async (request, reply) => {
        try {
            const prompts = await prisma.aIPrompt.findMany({ orderBy: { promptId: 'asc' } });
            return prompts.map(p => ({ id: p.promptId, name: p.name, content: p.content, updatedAt: p.updatedAt }));
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch AI prompts' });
        }
    });

    // AI Prompts - Get One
    fastify.get<{ Params: { promptId: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        try {
            const { promptId } = request.params;
            const prompt = await prisma.aIPrompt.findUnique({ where: { promptId } });
            if (!prompt) return reply.code(404).send({ error: 'Prompt not found' });
            return { id: prompt.promptId, name: prompt.name, content: prompt.content, updatedAt: prompt.updatedAt };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch AI prompt' });
        }
    });

    // AI Prompts - Upsert
    fastify.put<{ Params: { promptId: string }; Body: { content: string; name?: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        try {
            const { promptId } = request.params;
            const { content, name } = request.body;
            if (!content) return reply.code(400).send({ error: 'Content is required' });
            const prompt = await prisma.aIPrompt.upsert({
                where: { promptId },
                update: { content, name },
                create: { promptId, content, name }
            });
            return { id: prompt.promptId, name: prompt.name, content: prompt.content, updatedAt: prompt.updatedAt };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to save AI prompt' });
        }
    });

    // AI Prompts - Delete
    fastify.delete<{ Params: { promptId: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        try {
            const { promptId } = request.params;
            await prisma.aIPrompt.delete({ where: { promptId } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to delete AI prompt' });
        }
    });

    // GeoIP Status
    fastify.get('/geoip-status', async (request, reply) => {
        try {
            const { getDatabaseStatus } = await import('../services/tracking/GeoIPService');
            const databases = getDatabaseStatus();

            return {
                databases: databases.map(db => ({
                    source: db.source,
                    installed: true,
                    size: db.size,
                    sizeFormatted: `${(db.size / 1024 / 1024).toFixed(1)} MB`,
                    buildDate: db.buildDate.toISOString(),
                    type: db.dbType
                }))
            };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to check GeoIP status' });
        }
    });

    // Force GeoIP Update
    fastify.post('/geoip-force-update', async (request, reply) => {
        try {
            const { updateGeoLiteDB } = await import('../services/tracking/GeoIPService');
            const success = await updateGeoLiteDB();
            if (success) {
                return { success: true, message: 'GeoIP database updated successfully' };
            } else {
                return reply.code(400).send({ error: 'Update failed or already in progress' });
            }
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || 'Failed to update GeoIP database' });
        }
    });

    // GeoIP Upload - using @fastify/multipart 
    fastify.post('/upload-geoip-db', async (request, reply) => {
        try {
            const data = await (request as any).file();
            if (!data) return reply.code(400).send({ error: 'No file uploaded' });

            const filename = data.filename;
            if (!filename.endsWith('.mmdb')) return reply.code(400).send({ error: 'Only .mmdb files are accepted' });

            const dataDir = path.join(__dirname, '../../data');
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

            const filePath = path.join(dataDir, 'GeoLite2-City.mmdb');
            const writeStream = fs.createWriteStream(filePath);

            for await (const chunk of data.file) {
                writeStream.write(chunk);
            }
            writeStream.end();

            await initGeoIP(true);

            const fileStat = fs.statSync(filePath);
            return {
                success: true,
                message: 'GeoIP database uploaded and loaded successfully',
                stats: { size: fileStat.size, sizeFormatted: `${(fileStat.size / 1024 / 1024).toFixed(1)} MB`, lastModified: fileStat.mtime.toISOString() }
            };
        } catch (e: any) {
            Logger.error('Failed to upload GeoIP database', { error: e });
            return reply.code(500).send({ error: e.message || 'Failed to upload GeoIP database' });
        }
    });

    // =====================================================
    // Webhook Delivery Management
    // =====================================================

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
            const { WebhookDeliveryService } = await import('../services/WebhookDeliveryService');

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
            const { WebhookDeliveryService } = await import('../services/WebhookDeliveryService');

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
            const { WebhookDeliveryService } = await import('../services/WebhookDeliveryService');
            const { processWebhookPayload } = await import('./webhook');

            const delivery = await WebhookDeliveryService.replay(deliveryId);
            if (!delivery) return reply.code(404).send({ error: 'Delivery not found' });

            try {
                await processWebhookPayload(
                    delivery.accountId,
                    delivery.topic,
                    delivery.payload as Record<string, unknown>
                );
                await WebhookDeliveryService.markProcessed(delivery.id);

                return { success: true, message: 'Webhook replayed successfully' };
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
            const { WebhookDeliveryService } = await import('../services/WebhookDeliveryService');
            const count = await WebhookDeliveryService.getFailedCount();
            return { failedCount24h: count };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to fetch stats' });
        }
    });

    // =====================================================
    // Rate Limit Management
    // =====================================================

    // Get rate limit config for an account
    fastify.get<{ Params: { accountId: string } }>('/rate-limits/:accountId', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { RateLimitService } = await import('../services/RateLimitService');

            const [config, usage] = await Promise.all([
                RateLimitService.getAccountConfig(accountId),
                RateLimitService.getUsageStats(accountId),
            ]);

            return { config, usage };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to fetch rate limit config' });
        }
    });

    // Update rate limit config for an account
    fastify.put<{
        Params: { accountId: string };
        Body: { maxRequests?: number; windowSeconds?: number; tier?: string }
    }>('/rate-limits/:accountId', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { maxRequests, windowSeconds, tier } = request.body;
            const { RateLimitService } = await import('../services/RateLimitService');

            const config = await RateLimitService.setAccountConfig(accountId, {
                maxRequests,
                windowSeconds,
                tier,
            });

            return { success: true, config };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to update rate limit config' });
        }
    });

    // Reset rate limit counter for an account
    fastify.post<{ Params: { accountId: string } }>('/rate-limits/:accountId/reset', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { RateLimitService } = await import('../services/RateLimitService');

            await RateLimitService.resetCounter(accountId);
            return { success: true, message: 'Rate limit counter reset' };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to reset rate limit counter' });
        }
    });

    // Get default tier limits
    fastify.get('/rate-limits/tiers/defaults', async () => {
        const { RateLimitService } = await import('../services/RateLimitService');
        return RateLimitService.getDefaultLimits();
    });
};

export default adminRoutes;

