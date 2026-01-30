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
            const { accountId, visitorId, type, url, payload, pageTitle, referrer, utmSource, utmMedium, utmCampaign, is404, clickId, clickPlatform, landingReferrer } = body;

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

            let ip = request.headers['x-forwarded-for'] || request.ip;
            if (Array.isArray(ip)) ip = ip[0];

            const session = await TrackingService.processEvent({
                accountId, visitorId, type, url, payload, pageTitle,
                ipAddress: ip as string,
                userAgent: request.headers['user-agent'] as string,
                referrer, utmSource, utmMedium, utmCampaign, is404,
                clickId, clickPlatform, landingReferrer
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
            const { accountId, visitorId, type, url, payload, pageTitle, referrer, utmSource, utmMedium, utmCampaign, userAgent: bodyUserAgent, is404, clickId, clickPlatform, landingReferrer } = body;

            if (!accountId || !visitorId || !type) {
                return reply.code(400).send({ error: 'Missing required fields' });
            }

            if (!(await isValidAccount(accountId))) {
                return reply.code(400).send({ error: 'Invalid account' });
            }

            if (isRateLimited(accountId)) {
                return reply.code(429).send({ error: 'Rate limit exceeded' });
            }

            let ip = request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || request.ip;
            if (Array.isArray(ip)) ip = ip[0];
            if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();

            const session = await TrackingService.processEvent({
                accountId, visitorId, type, url, payload, pageTitle,
                ipAddress: ip as string,
                userAgent: bodyUserAgent || request.headers['user-agent'] as string,
                referrer, utmSource, utmMedium, utmCampaign, is404,
                clickId, clickPlatform, landingReferrer
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
};

export default trackingIngestionRoutes;
