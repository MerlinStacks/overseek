/**
 * Tracking Ingestion Routes - Fastify Plugin
 * Public event ingestion endpoints: POST /events, /e, pixel tracking.
 */

import { FastifyPluginAsync } from 'fastify';
import { TrackingService } from '../services/TrackingService';
import { Logger } from '../utils/logger';
import { isValidAccount, isRateLimited } from '../middleware/trackingMiddleware';

// Transparent 1x1 GIF for pixel tracking
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

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
            const body = request.body as any;
            const { accountId, visitorId, type, url, payload, pageTitle, referrer, utmSource, utmMedium, utmCampaign, is404, clickId, clickPlatform, landingReferrer, eventId, visitorIp } = body;

            if (!accountId || !visitorId || !type) {
                return reply.code(400).send({ error: 'Missing required fields' });
            }

            if (!(await isValidAccount(accountId))) {
                return reply.code(400).send({ error: 'Invalid account' });
            }

            if (isRateLimited(accountId)) {
                return reply.code(429).send({ error: 'Rate limit exceeded' });
            }

            Logger.debug('Tracking event received', { type, accountId });

            // Prefer visitorIp from body (WC plugin sends real visitor IP for server-side events)
            let ip: string | string[] | undefined = visitorIp || request.headers['x-forwarded-for'] || request.ip;
            if (Array.isArray(ip)) ip = ip[0];
            if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();

            // Fall back to payload.eventId when top-level is missing (WC plugin nests it)
            const resolvedEventId = eventId || payload?.eventId;

            const session = await TrackingService.processEvent({
                accountId, visitorId, type, url, payload, pageTitle,
                ipAddress: ip as string,
                userAgent: request.headers['user-agent'] as string,
                referrer, utmSource, utmMedium, utmCampaign, is404,
                clickId, clickPlatform, landingReferrer, eventId: resolvedEventId
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
            const body = request.body as any;
            const { accountId, visitorId, type, url, payload, pageTitle, referrer, utmSource, utmMedium, utmCampaign, userAgent: bodyUserAgent, is404, clickId, clickPlatform, landingReferrer, eventId, visitorIp } = body;

            if (!accountId || !visitorId || !type) {
                return reply.code(400).send({ error: 'Missing required fields' });
            }

            if (!(await isValidAccount(accountId))) {
                return reply.code(400).send({ error: 'Invalid account' });
            }

            if (isRateLimited(accountId)) {
                return reply.code(429).send({ error: 'Rate limit exceeded' });
            }

            // Prefer visitorIp from body (WC plugin sends real visitor IP for server-side events)
            let ip: string | string[] | undefined = visitorIp || request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || request.ip;
            if (Array.isArray(ip)) ip = ip[0];
            if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();

            // Fall back to payload.eventId when top-level is missing (WC plugin nests it)
            const resolvedEventId = eventId || payload?.eventId;

            const session = await TrackingService.processEvent({
                accountId, visitorId, type, url, payload, pageTitle,
                ipAddress: ip as string,
                userAgent: bodyUserAgent !== undefined ? bodyUserAgent : request.headers['user-agent'] as string,
                referrer, utmSource, utmMedium, utmCampaign, is404,
                clickId, clickPlatform, landingReferrer, eventId: resolvedEventId
            });

            if (session) {
                // Logger.debug('Tracking processed', { type, visitorId, sessionId: session.id });
            } else {
                Logger.info('Tracking filtered (bot/static)', { type, visitorId, userAgent: bodyUserAgent || request.headers['user-agent'] });
            }

            const ecommerceTypes = ['add_to_cart', 'remove_from_cart', 'cart_view', 'checkout_view', 'checkout_start', 'purchase'];
            if (ecommerceTypes.includes(type)) {
                Logger.info('E-commerce event received', { type, visitorId, accountId, payload });
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

            if (!accountId || !visitorId || !type || !(await isValidAccount(accountId)) || isRateLimited(accountId)) {
                reply.header('Content-Type', 'image/gif');
                reply.header('Cache-Control', 'no-store');
                return reply.send(TRANSPARENT_GIF);
            }

            let ip = request.headers['x-forwarded-for'] || request.ip;
            if (Array.isArray(ip)) ip = ip[0];

            let payload = {};
            if (payloadStr) {
                try { payload = JSON.parse(decodeURIComponent(payloadStr)); } catch (_e) { /* Intentionally ignored: invalid payload is non-fatal, proceed with empty object */ }
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
            const body = request.body as { accountId?: string; visitorId?: string; eventName?: string; properties?: any; url?: string };
            const { accountId, visitorId, eventName, properties } = body;

            if (!accountId || !visitorId || !eventName) {
                return reply.code(400).send({ error: 'Missing required fields' });
            }

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
            const body = request.body as { accountId?: string; samples?: any[] };

            if (!body.accountId || !Array.isArray(body.samples) || !body.samples.length) {
                return reply.code(400).send({ error: 'accountId and samples required' });
            }

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
        reply.code(202).send({ ok: true });

        try {
            const body = request.body as { accountId?: string; userAgent?: string; url?: string; ip?: string };

            if (!body.accountId || !body.userAgent) return;
            if (body.userAgent.length > 1000) return;

            if (!(await isValidAccount(body.accountId))) return;
            if (isRateLimited(body.accountId)) return;

            const { logHitIfIdentifiable } = await import('../services/tracking/CrawlerService');
            await logHitIfIdentifiable(body.accountId, body.userAgent, body.url, body.ip);
        } catch (error) {
            Logger.debug('[BotHit] Failed (non-fatal)', { error });
        }
    });
};

export default trackingIngestionRoutes;

