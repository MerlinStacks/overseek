/**
 * Tracking Ingestion Routes - Fastify Plugin
 * Public event ingestion endpoints: POST /events, /e, pixel tracking.
 */

import { FastifyPluginAsync } from 'fastify';
import { TrackingService } from '../services/TrackingService';
import { Logger } from '../utils/logger';
import { hasValidTrackingAuth, isValidAccount, isRateLimited, requiresTrackingAuth } from '../middleware/trackingMiddleware';
import * as z from 'zod';
import { incrementBotShieldMetric } from '../services/tracking/BotShieldMetrics';

// Transparent 1x1 GIF for pixel tracking
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const botHitPayloadSchema = z.object({
    accountId: z.string().uuid(),
    userAgent: z.string().min(1).max(1000),
    url: z.string().max(1000).optional(),
    ip: z.string().max(128).optional(),
});

const trackingEventPayloadSchema = z.object({
    accountId: z.string().uuid(),
    visitorId: z.string().min(1).max(128),
    type: z.string().min(1).max(100),
    url: z.string().max(2000).default(''),
    payload: z.unknown().optional().default({}),
    pageTitle: z.string().max(500).optional(),
    referrer: z.string().max(2000).optional(),
    referrerDomain: z.string().max(255).optional(),
    referrerType: z.string().max(50).optional(),
    utmSource: z.string().max(255).optional(),
    utmMedium: z.string().max(255).optional(),
    utmCampaign: z.string().max(255).optional(),
    userAgent: z.string().max(1000).optional(),
    is404: z.boolean().optional(),
    clickId: z.string().max(500).optional(),
    clickPlatform: z.string().max(100).optional(),
    landingReferrer: z.string().max(2000).optional(),
    eventId: z.string().max(150).optional(),
    visitorIp: z.string().max(128).optional(),
    consentState: z.enum(['granted', 'denied']).optional(),
});

const customEventPayloadSchema = z.object({
    accountId: z.string().uuid(),
    visitorId: z.string().min(1).max(128),
    eventName: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/),
    properties: z.unknown().optional().default({}),
    url: z.string().max(2000).optional().default(''),
});

const vitalsPayloadSchema = z.object({
    accountId: z.string().uuid(),
    samples: z.array(z.object({
        metric: z.string().max(20),
        value: z.number().finite().min(0).max(120000),
        rating: z.string().max(32),
        url: z.string().max(2000).optional().default('/'),
        pageType: z.string().max(50).optional().default('other'),
        device: z.string().max(50).optional().default('desktop'),
        effectiveType: z.string().max(50).optional(),
    })).min(1).max(10),
});

const BOT_HIT_IP_WINDOW_MS = 60 * 1000;
const BOT_HIT_IP_MAX_REQUESTS = 180;
const BOT_HIT_IP_MAX_KEYS = 5000;
const botHitIpHits = new Map<string, { count: number; startedAt: number }>();

const VITALS_IP_WINDOW_MS = 60 * 1000;
const VITALS_IP_MAX_REQUESTS = 300;
const vitalsIpHits = new Map<string, { count: number; startedAt: number }>();

const UNSIGNED_COMPATIBLE_EVENT_TYPES = new Set([
    'pageview',
    'product_view',
    'cart_view',
    'checkout_view',
]);

function pruneBotHitIpHits(now: number): void {
    for (const [key, value] of botHitIpHits) {
        if (now - value.startedAt > BOT_HIT_IP_WINDOW_MS || botHitIpHits.size > BOT_HIT_IP_MAX_KEYS) {
            botHitIpHits.delete(key);
        }
    }
}

function isBotHitIpRateLimited(ip: string): boolean {
    const now = Date.now();
    pruneBotHitIpHits(now);

    const existing = botHitIpHits.get(ip);
    if (!existing || now - existing.startedAt > BOT_HIT_IP_WINDOW_MS) {
        botHitIpHits.set(ip, { count: 1, startedAt: now });
        return false;
    }

    existing.count += 1;
    return existing.count > BOT_HIT_IP_MAX_REQUESTS;
}

function isVitalsIpRateLimited(ip: string): boolean {
    const now = Date.now();
    for (const [key, value] of vitalsIpHits) {
        if (now - value.startedAt > VITALS_IP_WINDOW_MS || vitalsIpHits.size > BOT_HIT_IP_MAX_KEYS) {
            vitalsIpHits.delete(key);
        }
    }

    const existing = vitalsIpHits.get(ip);
    if (!existing || now - existing.startedAt > VITALS_IP_WINDOW_MS) {
        vitalsIpHits.set(ip, { count: 1, startedAt: now });
        return false;
    }

    existing.count += 1;
    return existing.count > VITALS_IP_MAX_REQUESTS;
}

function getRequestSourceIp(request: any): string {
    return request.raw?.socket?.remoteAddress || request.ip || 'unknown';
}

function normalizeIpHeader(ip: string | string[] | undefined): string | undefined {
    if (Array.isArray(ip)) ip = ip[0];
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
    return typeof ip === 'string' && ip.trim() ? ip.trim() : undefined;
}

async function requireSignedTrackingRequest(accountId: string, request: any, reply: any): Promise<boolean> {
    if (!(await isValidAccount(accountId))) {
        reply.code(400).send({ error: 'Invalid account' });
        return false;
    }

    if (!(await hasValidTrackingAuth(accountId, request.headers.authorization))) {
        reply.code(401).send({ error: 'Tracking auth required' });
        return false;
    }

    if (isRateLimited(accountId)) {
        reply.code(429).send({ error: 'Rate limit exceeded' });
        return false;
    }

    return true;
}

async function authorizeTrackingEvent(accountId: string, type: string, request: any, reply: any): Promise<boolean> {
    if (!(await isValidAccount(accountId))) {
        reply.code(400).send({ error: 'Invalid account' });
        return false;
    }

    if (isRateLimited(accountId)) {
        reply.code(429).send({ error: 'Rate limit exceeded' });
        return false;
    }

    if (UNSIGNED_COMPATIBLE_EVENT_TYPES.has(type)) {
        return true;
    }

    if (await requiresTrackingAuth(accountId) && !(await hasValidTrackingAuth(accountId, request.headers.authorization))) {
        reply.code(401).send({ error: 'Tracking auth required' });
        return false;
    }

    return true;
}

const trackingIngestionRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * DEPRECATED: Returns no-op script (server-side tracking only).
     */
    fastify.get('/tracking.js', async (request, reply) => {
        const query = request.query as { id?: string };
        Logger.debug('Tracking script requested (deprecated)', { accountId: query.id });
        reply.header('Content-Type', 'application/javascript');
        return '(function(){})();';
    });

    /**
     * POST /events - Main event ingestion
     */
    fastify.post('/events', async (request, reply) => {
        try {
            const parsed = trackingEventPayloadSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid payload' });
            }

            const body = parsed.data as any;
            const { accountId, visitorId, type, url, payload, pageTitle, referrer, referrerDomain, referrerType, utmSource, utmMedium, utmCampaign, userAgent: bodyUserAgent, is404, clickId, clickPlatform, landingReferrer, eventId, visitorIp, consentState } = body;

            if (!(await authorizeTrackingEvent(accountId, type, request, reply))) return;

            Logger.debug('Tracking event received', { type, accountId });

            // Prefer visitorIp from body (WC plugin sends real visitor IP for server-side events)
            const ip = normalizeIpHeader(visitorIp || request.headers['x-forwarded-for'] || request.ip);

            // Fall back to payload.eventId when top-level is missing (WC plugin nests it)
            const resolvedEventId = eventId || payload?.eventId;

            const session = await TrackingService.processEvent({
                accountId, visitorId, type, url, payload, pageTitle,
                ipAddress: ip as string,
                userAgent: bodyUserAgent !== undefined ? bodyUserAgent : request.headers['user-agent'] as string,
                referrer, referrerDomain, referrerType, utmSource, utmMedium, utmCampaign, is404,
                clickId, clickPlatform, landingReferrer, eventId: resolvedEventId,
                consentState
            });

            if (session) {
                // Logger.debug('Tracking processed', { type, visitorId, sessionId: session.id });
            } else {
                Logger.info('Tracking filtered (bot/static)', { type, visitorId, userAgent: request.headers['user-agent'] });
            }

            return { success: true };
        } catch (error) {
            Logger.error('Tracking Error', { error });
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    /**
     * POST /e - Short alias (ad-blocker friendly)
     */
    fastify.post('/e', async (request, reply) => {
        try {
            const parsed = trackingEventPayloadSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid payload' });
            }

            const body = parsed.data as any;
            const { accountId, visitorId, type, url, payload, pageTitle, referrer, referrerDomain, referrerType, utmSource, utmMedium, utmCampaign, userAgent: bodyUserAgent, is404, clickId, clickPlatform, landingReferrer, eventId, visitorIp, consentState } = body;

            if (!(await authorizeTrackingEvent(accountId, type, request, reply))) return;

            // Prefer visitorIp from body (WC plugin sends real visitor IP for server-side events)
            const ip = normalizeIpHeader(visitorIp || request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || request.ip);

            // Fall back to payload.eventId when top-level is missing (WC plugin nests it)
            const resolvedEventId = eventId || payload?.eventId;

            const session = await TrackingService.processEvent({
                accountId, visitorId, type, url, payload, pageTitle,
                ipAddress: ip as string,
                userAgent: bodyUserAgent !== undefined ? bodyUserAgent : request.headers['user-agent'] as string,
                referrer, referrerDomain, referrerType, utmSource, utmMedium, utmCampaign, is404,
                clickId, clickPlatform, landingReferrer, eventId: resolvedEventId,
                consentState
            });

            if (session) {
                // Logger.debug('Tracking processed', { type, visitorId, sessionId: session.id });
            } else {
                Logger.info('Tracking filtered (bot/static)', { type, visitorId, userAgent: bodyUserAgent || request.headers['user-agent'] });
            }

            const ecommerceTypes = ['add_to_cart', 'remove_from_cart', 'cart_view', 'checkout_view', 'checkout_start', 'purchase'];
            if (ecommerceTypes.includes(type)) {
                const payloadKeys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
                Logger.info('E-commerce event received', { type, visitorId, accountId, payloadKeys });
            }

            return { success: true };
        } catch (error) {
            const errorDetails = error instanceof Error
                ? { message: error.message, stack: error.stack, name: error.name }
                : { raw: String(error) };
            const body = request.body as any;
            Logger.error('Tracking Error', {
                error: errorDetails,
                eventType: body?.type,
                visitorId: body?.visitorId,
                accountId: body?.accountId,
                url: body?.url,
                payloadKeys: body?.payload ? Object.keys(body.payload) : []
            });
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    /**
     * GET /p.gif - Pixel tracking fallback
     */
    fastify.get('/p.gif', async (request, reply) => {
        try {
            const query = request.query as { a?: string; v?: string; t?: string; u?: string; p?: string };
            const { a: accountId, v: visitorId, t: type, u: url, p: payloadStr } = query;

            const canProcessPixel = Boolean(accountId && visitorId && type)
                && await isValidAccount(accountId || '')
                && (UNSIGNED_COMPATIBLE_EVENT_TYPES.has(type || '') || await hasValidTrackingAuth(accountId || '', request.headers.authorization))
                && !isRateLimited(accountId || '');

            if (!canProcessPixel) {
                reply.header('Content-Type', 'image/gif');
                reply.header('Cache-Control', 'no-store');
                return reply.send(TRANSPARENT_GIF);
            }

            const ip = normalizeIpHeader(request.headers['x-forwarded-for'] || request.ip);

            let payload = {};
            if (payloadStr) {
                try { payload = JSON.parse(decodeURIComponent(payloadStr)); } catch (_e) { Logger.debug('[TrackingIngestion] Invalid payload JSON, proceeding with empty object', { accountId, visitorId, type }); }
            }

            await TrackingService.processEvent({
                accountId, visitorId, type, url: url || '',
                payload, pageTitle: '',
                ipAddress: ip as string,
                userAgent: request.headers['user-agent'] as string,
                referrer: request.headers.referer || '',
            });

            reply.header('Content-Type', 'image/gif');
            reply.header('Cache-Control', 'no-store');
            return reply.send(TRANSPARENT_GIF);
        } catch (error) {
            Logger.error('Pixel Tracking Error', { error });
            reply.header('Content-Type', 'image/gif');
            reply.header('Cache-Control', 'no-store');
            return reply.send(TRANSPARENT_GIF);
        }
    });

    /**
     * POST /custom - Custom merchant events
     */
    fastify.post('/custom', async (request, reply) => {
        try {
            const parsed = customEventPayloadSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid payload' });
            }

            const body = parsed.data as { accountId: string; visitorId: string; eventName: string; properties?: any; url?: string };
            const { accountId, visitorId, eventName, properties } = body;

            if (!(await requireSignedTrackingRequest(accountId, request, reply))) return;

            await TrackingService.processEvent({
                accountId, visitorId,
                type: `custom:${eventName}`,
                url: body.url || '',
                payload: properties || {}
            });

            return { success: true };
        } catch (error) {
            Logger.error('Custom Event Error', { error });
            return reply.code(500).send({ error: 'Failed to track custom event' });
        }
    });

    /**
     * POST /vitals - Core Web Vitals ingestion
     * Receives batched measurements from the WC plugin via sendBeacon.
     * No session upsert or attribution needed — pure metric storage.
     */
    fastify.post('/vitals', async (request, reply) => {
        try {
            const sourceIp = getRequestSourceIp(request);
            if (isVitalsIpRateLimited(sourceIp)) {
                return reply.code(429).send({ error: 'Rate limit exceeded' });
            }

            const parsed = vitalsPayloadSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid payload' });
            }

            const body = parsed.data;

            if (!(await isValidAccount(body.accountId))) {
                return reply.code(400).send({ error: 'Invalid account' });
            }

            if (isRateLimited(body.accountId)) {
                return reply.code(429).send({ error: 'Rate limit exceeded' });
            }

            const { ingestVitals } = await import('../services/tracking/WebVitalsService');
            await ingestVitals(body.accountId, body.samples);

            return { success: true };
        } catch (error) {
            Logger.error('Web Vitals ingestion error', { error });
            // Never reveal error details — endpoint is public
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    /**
     * POST /bot-hit - Unknown bot/crawler report from the WC plugin.
     *
     * Receives fire-and-forget beacons from the PHP crawler guard when an
     * unrecognised but bot-like UA is detected. Populates Bot Shield without
     * requiring JS execution on the store.
     *
     * Why respond-then-process: WC plugin sends with blocking:false and doesn't
     * read the response. We still 202 immediately so the OS-level socket closes
     * cleanly, then do the async work after reply is flushed.
     */
    fastify.post('/bot-hit', async (request, reply) => {
        incrementBotShieldMetric('botHitRequests');
        reply.code(202).send({ ok: true });

        try {
            const sourceIp = getRequestSourceIp(request);
            if (isBotHitIpRateLimited(sourceIp)) {
                incrementBotShieldMetric('botHitRateLimited');
                Logger.warn('[BotHit] Source IP rate limited', { ip: sourceIp });
                return;
            }

            const parsedBody = botHitPayloadSchema.safeParse(request.body);
            if (!parsedBody.success) {
                incrementBotShieldMetric('botHitInvalidPayload');
                Logger.debug('[BotHit] Invalid payload rejected', {
                    ip: sourceIp,
                    issue: parsedBody.error.issues[0]?.message
                });
                return;
            }

            const body = parsedBody.data;

            if (!(await isValidAccount(body.accountId))) {
                incrementBotShieldMetric('botHitInvalidAccount');
                return;
            }
            if (!(await hasValidTrackingAuth(body.accountId, request.headers.authorization))) {
                incrementBotShieldMetric('botHitInvalidPayload');
                return;
            }
            if (isRateLimited(body.accountId)) {
                incrementBotShieldMetric('botHitDroppedByAccountRateLimit');
                return;
            }

            const { logHitIfIdentifiable } = await import('../services/tracking/CrawlerService');
            await logHitIfIdentifiable(body.accountId, body.userAgent, body.url, body.ip);
            incrementBotShieldMetric('botHitProcessed');
        } catch (error) {
            Logger.debug('[BotHit] Failed (non-fatal)', { error });
        }
    });
};

export default trackingIngestionRoutes;
