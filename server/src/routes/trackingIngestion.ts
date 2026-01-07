/**
 * Tracking Ingestion Routes
 * 
 * Public event ingestion endpoints: POST /events, /e, pixel tracking.
 */

import express from 'express';
import { TrackingService } from '../services/TrackingService';
import { Logger } from '../utils/logger';
import { isValidAccount, isRateLimited } from '../middleware/trackingMiddleware';

const router = express.Router();

// Transparent 1x1 GIF for pixel tracking
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * DEPRECATED: Returns no-op script (server-side tracking only).
 */
router.get('/tracking.js', (req, res) => {
    Logger.debug('Tracking script requested (deprecated)', { accountId: req.query.id });
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`(function(){})();`);
});

/**
 * POST /api/tracking/events - Main event ingestion
 */
router.post('/events', async (req, res) => {
    try {
        const { accountId, visitorId, type, url, payload, pageTitle, referrer, utmSource, utmMedium, utmCampaign, is404, clickId, clickPlatform, landingReferrer } = req.body;

        if (!accountId || !visitorId || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!(await isValidAccount(accountId))) {
            return res.status(400).json({ error: 'Invalid account' });
        }

        if (isRateLimited(accountId)) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        Logger.debug('Tracking event received', { type, accountId });

        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (Array.isArray(ip)) ip = ip[0];

        await TrackingService.processEvent({
            accountId, visitorId, type, url, payload, pageTitle,
            ipAddress: ip as string,
            userAgent: req.headers['user-agent'],
            referrer, utmSource, utmMedium, utmCampaign, is404,
            clickId, clickPlatform, landingReferrer
        });

        res.json({ success: true });
    } catch (error) {
        Logger.error('Tracking Error', { error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * POST /api/tracking/e - Short alias (ad-blocker friendly)
 */
router.post('/e', async (req, res) => {
    try {
        const { accountId, visitorId, type, url, payload, pageTitle, referrer, utmSource, utmMedium, utmCampaign, userAgent: bodyUserAgent, is404, clickId, clickPlatform, landingReferrer } = req.body;

        if (!accountId || !visitorId || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!(await isValidAccount(accountId))) {
            return res.status(400).json({ error: 'Invalid account' });
        }

        if (isRateLimited(accountId)) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        let ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
        if (Array.isArray(ip)) ip = ip[0];
        if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();

        await TrackingService.processEvent({
            accountId, visitorId, type, url, payload, pageTitle,
            ipAddress: ip as string,
            userAgent: bodyUserAgent || req.headers['user-agent'],
            referrer, utmSource, utmMedium, utmCampaign, is404,
            clickId, clickPlatform, landingReferrer
        });

        res.json({ success: true });
    } catch (error) {
        Logger.error('Tracking Error', { error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/tracking/p.gif - Pixel tracking fallback
 */
router.get('/p.gif', async (req, res) => {
    try {
        const { a: accountId, v: visitorId, t: type, u: url, p: payloadStr } = req.query;

        if (!accountId || !visitorId || !type || !(await isValidAccount(accountId as string)) || isRateLimited(accountId as string)) {
            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(TRANSPARENT_GIF);
        }

        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (Array.isArray(ip)) ip = ip[0];

        let payload = {};
        if (payloadStr) {
            try { payload = JSON.parse(decodeURIComponent(payloadStr as string)); } catch { }
        }

        await TrackingService.processEvent({
            accountId: accountId as string,
            visitorId: visitorId as string,
            type: type as string,
            url: url as string || '',
            payload,
            pageTitle: '',
            ipAddress: ip as string,
            userAgent: req.headers['user-agent'],
            referrer: req.headers.referer || '',
        });

        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Cache-Control', 'no-store');
        res.send(TRANSPARENT_GIF);
    } catch (error) {
        Logger.error('Pixel Tracking Error', { error });
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Cache-Control', 'no-store');
        res.send(TRANSPARENT_GIF);
    }
});

/**
 * POST /api/tracking/custom - Custom merchant events
 */
router.post('/custom', async (req, res) => {
    try {
        const { accountId, visitorId, eventName, properties } = req.body;

        if (!accountId || !visitorId || !eventName) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await TrackingService.processEvent({
            accountId, visitorId,
            type: `custom:${eventName}`,
            url: req.body.url || '',
            payload: properties || {}
        });

        res.json({ success: true });
    } catch (error) {
        Logger.error('Custom Event Error', { error });
        res.status(500).json({ error: 'Failed to track custom event' });
    }
});

export default router;
