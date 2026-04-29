/**
 * CAPI Settings Routes — Fastify Plugin
 *
 * Management endpoints for server-side conversion tracking configuration.
 * Handles platform credential storage, test events, and delivery log viewing.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { ConversionForwarder } from '../services/tracking/ConversionForwarder';
import { requireAuthFastify } from '../middleware/auth';

/** Maps URL platform param → AccountFeature.featureKey */
const PLATFORM_FEATURE_KEY: Record<string, string> = {
    meta: 'META_CAPI',
    tiktok: 'TIKTOK_EVENTS_API',
    google: 'GOOGLE_ENHANCED_CONVERSIONS',
    pinterest: 'PINTEREST_CAPI',
    ga4: 'GA4_MEASUREMENT',
    snapchat: 'SNAPCHAT_CAPI',
    microsoft: 'MICROSOFT_CAPI',
    twitter: 'TWITTER_CAPI',
    _consent: 'CONSENT_MODE',
};

const capiRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /api/capi/config — Get all CAPI platform configs for account
     */
    fastify.get('/config', { preHandler: requireAuthFastify }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const features = await prisma.accountFeature.findMany({
            where: {
                accountId,
                featureKey: { in: Object.values(PLATFORM_FEATURE_KEY) },
            },
            select: {
                featureKey: true,
                isEnabled: true,
                config: true,
                updatedAt: true,
            },
        });

        // Build a map of platform → config for the frontend
        const platforms: Record<string, any> = {};
        let consent: Record<string, any> | null = null;
        for (const [urlKey, featureKey] of Object.entries(PLATFORM_FEATURE_KEY)) {
            const feature = features.find((f) => f.featureKey === featureKey);
            if (urlKey === '_consent') {
                consent = (feature?.config as Record<string, any>) || null;
                continue;
            }
            platforms[urlKey] = {
                enabled: feature?.isEnabled || false,
                config: feature?.config || {},
                updatedAt: feature?.updatedAt || null,
            };
        }

        return { platforms, consent };
    });

    /**
     * PUT /api/capi/config/:platform — Save config for a specific platform
     */
    fastify.put('/config/:platform', { preHandler: requireAuthFastify }, async (request, reply) => {
        const { platform } = request.params as { platform: string };
        const accountId = request.accountId;
        const { enabled, config } = request.body as {
            enabled: boolean;
            config: Record<string, any>;
        };

        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const featureKey = PLATFORM_FEATURE_KEY[platform];
        if (!featureKey) {
            return reply.code(400).send({
                error: `Invalid platform: ${platform}. Supported: ${Object.keys(PLATFORM_FEATURE_KEY).join(', ')}`,
            });
        }

        await prisma.accountFeature.upsert({
            where: { accountId_featureKey: { accountId, featureKey } },
            create: {
                accountId,
                featureKey,
                isEnabled: enabled,
                config: config as object,
            },
            update: {
                isEnabled: enabled,
                config: config as object,
            },
        });

        // Invalidate cached config so ConversionForwarder picks up changes immediately
        ConversionForwarder.invalidateCache(accountId);

        Logger.info('[CAPI] Platform config updated', { accountId, platform, enabled });
        return { success: true };
    });

    /**
     * DELETE /api/capi/config/:platform — Disable a platform
     */
    fastify.delete('/config/:platform', { preHandler: requireAuthFastify }, async (request, reply) => {
        const { platform } = request.params as { platform: string };
        const accountId = request.accountId;

        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const featureKey = PLATFORM_FEATURE_KEY[platform];
        if (!featureKey) {
            return reply.code(400).send({ error: `Invalid platform: ${platform}` });
        }

        await prisma.accountFeature.updateMany({
            where: { accountId, featureKey },
            data: { isEnabled: false },
        });

        ConversionForwarder.invalidateCache(accountId);

        Logger.info('[CAPI] Platform disabled', { accountId, platform });
        return { success: true };
    });

    /**
     * POST /api/capi/test/:platform — Send a test event to verify connectivity
     */
    fastify.post('/test/:platform', { preHandler: requireAuthFastify }, async (request, reply) => {
        const { platform } = request.params as { platform: string };
        const accountId = request.accountId;

        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const featureKey = PLATFORM_FEATURE_KEY[platform];
        if (!featureKey) {
            return reply.code(400).send({ error: `Invalid platform: ${platform}` });
        }

        // Get the platform config
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey } },
        });

        if (!feature?.isEnabled || !feature?.config) {
            return reply.code(400).send({ error: `Platform ${platform} is not configured` });
        }

        // Send a test purchase event through the ConversionForwarder
        const testData = {
            accountId,
            visitorId: 'test-visitor',
            type: 'purchase',
            url: 'https://example.com/test-order',
            eventId: `test-${Date.now()}`,
            payload: {
                orderId: 'TEST-001',
                total: 1.00,
                currency: 'USD',
                email: 'test@example.com',
                items: [{ id: '1', name: 'Test Product', quantity: 1, price: 1.00 }],
            },
        };

        try {
            await ConversionForwarder.forwardIfConversion(testData as any, null);
            return { success: true, message: `Test event sent to ${platform}. Check your platform's event debugger.` };
        } catch (error: any) {
            Logger.error('[CAPI] Test event failed', { platform, error: error.message });
            return reply.code(500).send({ error: `Test event failed: ${error.message}` });
        }
    });

    /**
     * GET /api/capi/deliveries — List recent CAPI delivery logs
     */
    fastify.get('/deliveries', { preHandler: requireAuthFastify }, async (request, reply) => {
        const accountId = request.accountId;
        const { platform, status, limit = '50', page = '1' } = request.query as {
            platform?: string;
            status?: string;
            limit?: string;
            page?: string;
        };

        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const take = Math.min(parseInt(limit, 10) || 50, 100);
        const skip = ((parseInt(page, 10) || 1) - 1) * take;

        const where: Record<string, any> = { accountId };
        if (platform) where.platform = platform.toUpperCase();
        if (status) where.status = status.toUpperCase();

        const [deliveries, total] = await Promise.all([
            prisma.conversionDelivery.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip,
                select: {
                    id: true,
                    platform: true,
                    eventName: true,
                    eventId: true,
                    status: true,
                    httpStatus: true,
                    attempts: true,
                    lastError: true,
                    response: true,
                    payload: true,
                    sentAt: true,
                    createdAt: true,
                },
            }),
            prisma.conversionDelivery.count({ where }),
        ]);

        return {
            deliveries,
            total,
            page: parseInt(page, 10) || 1,
            totalPages: Math.ceil(total / take),
        };
    });
    /**
     * GET /api/capi/health — Delivery health dashboard aggregations.
     * Returns per-platform success/failure rates, daily failure trend,
     * event type breakdown, and recent failures in a single request.
     */
    fastify.get('/health', { preHandler: requireAuthFastify }, async (request, reply) => {
        const accountId = request.accountId;
        const { range = '7d' } = request.query as { range?: string };
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const rangeMs: Record<string, number> = {
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000,
        };
        const ms = rangeMs[range] || rangeMs['7d'];
        const rangeStart = new Date(Date.now() - ms);
        const trendStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [platformSummary, failureTrend, eventBreakdown, recentFailures] = await Promise.all([
            // 1. Per-platform × status counts
            prisma.conversionDelivery.groupBy({
                by: ['platform', 'status'],
                where: { accountId, createdAt: { gte: rangeStart } },
                _count: { _all: true },
            }),

            // 2. Daily failure counts (always 30 days for stable chart)
            prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
                SELECT DATE("createdAt") as date, COUNT(*)::bigint as count
                FROM "ConversionDelivery"
                WHERE "accountId" = ${accountId}
                  AND "status" = 'FAILED'
                  AND "createdAt" >= ${trendStart}
                GROUP BY DATE("createdAt")
                ORDER BY date
            `,

            // 3. Per-platform × event × status counts
            prisma.conversionDelivery.groupBy({
                by: ['platform', 'eventName', 'status'],
                where: { accountId, createdAt: { gte: rangeStart } },
                _count: { _all: true },
            }),

            // 4. Recent failures (most recent 20)
            prisma.conversionDelivery.findMany({
                where: { accountId, status: 'FAILED' },
                orderBy: { createdAt: 'desc' },
                take: 20,
                select: {
                    id: true,
                    platform: true,
                    eventName: true,
                    eventId: true,
                    httpStatus: true,
                    lastError: true,
                    attempts: true,
                    createdAt: true,
                },
            }),
        ]);

        return {
            platformSummary: platformSummary.map(r => ({
                platform: r.platform,
                status: r.status,
                count: r._count._all,
            })),
            failureTrend: failureTrend.map(r => ({
                date: String(r.date),
                count: Number(r.count),
            })),
            eventBreakdown: eventBreakdown.map(r => ({
                platform: r.platform,
                eventName: r.eventName,
                status: r.status,
                count: r._count._all,
            })),
            recentFailures,
            range,
        };
    });

    /**
     * GET /api/capi/pixels/:accountId — Public endpoint for WC plugin.
     *
     * Why public: The WC plugin fetches pixel IDs via wp_remote_get and caches
     * with a transient. Only non-secret fields (pixel IDs, event toggles) are
     * returned — access tokens are never exposed.
     */
    fastify.get('/pixels/:accountId', async (request, reply) => {
        const { accountId } = request.params as { accountId: string };
        if (!accountId) return reply.code(400).send({ error: 'accountId required' });

        const features = await prisma.accountFeature.findMany({
            where: {
                accountId,
                featureKey: { in: Object.values(PLATFORM_FEATURE_KEY) },
            },
            select: { featureKey: true, isEnabled: true, config: true },
        });

        /** Strip access tokens — only return pixel IDs and event toggles */
        const SAFE_FIELDS: Record<string, string[]> = {
            META_CAPI: ['pixelId', 'events', 'advancedMatching', 'contentIdFormat', 'contentIdPrefix', 'contentIdSuffix', 'excludeShipping', 'excludeTax'],
            TIKTOK_EVENTS_API: ['pixelCode', 'events', 'advancedMatching'],
            GA4_MEASUREMENT: ['measurementId', 'events'],
            GOOGLE_ENHANCED_CONVERSIONS: ['conversionId', 'conversionLabel', 'conversionLabelAddToCart', 'conversionLabelBeginCheckout', 'conversionLabelViewItem', 'events'],
            PINTEREST_CAPI: ['tagId', 'events'],
            SNAPCHAT_CAPI: ['pixelId', 'events'],
            MICROSOFT_CAPI: ['tagId', 'events'],
            TWITTER_CAPI: ['pixelId', 'events'],
            CONSENT_MODE: ['autoAccept'],
        };

        const pixels: Record<string, any> = {};
        for (const [urlKey, featureKey] of Object.entries(PLATFORM_FEATURE_KEY)) {
            const feature = features.find(f => f.featureKey === featureKey);

            // Consent config goes under _consent key
            if (urlKey === '_consent') {
                if (feature) {
                    const raw = (feature.config as Record<string, any>) || {};
                    pixels['_consent'] = { autoAccept: !!raw.autoAccept };
                }
                continue;
            }

            if (!feature?.isEnabled) continue;

            const raw = (feature.config as Record<string, any>) || {};
            const allowed = SAFE_FIELDS[featureKey] || [];
            const safeConfig: Record<string, any> = {};
            for (const key of allowed) {
                if (raw[key] !== undefined) safeConfig[key] = raw[key];
            }
            pixels[urlKey] = safeConfig;
        }

        // Long cache header — WC plugin also caches via transient
        reply.header('Cache-Control', 'public, max-age=300');
        return pixels;
    });
};

export default capiRoutes;
