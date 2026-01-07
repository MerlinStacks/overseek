
import express from 'express';
import { TrackingService } from '../services/TrackingService';
import { prisma } from '../utils/prisma';
import { verifyToken } from '../utils/auth';
import { Logger } from '../utils/logger';

import { requireAuth } from '../middleware/auth';

const router = express.Router();

// =============================================================================
// Security: Account Validation Cache
// =============================================================================
const accountCache = new Map<string, number>(); // accountId -> timestamp
const CACHE_TTL = 60000; // 1 minute

async function isValidAccount(accountId: string): Promise<boolean> {
    const cached = accountCache.get(accountId);
    if (cached && Date.now() - cached < CACHE_TTL) {
        return true;
    }

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true }
    });

    if (account) {
        accountCache.set(accountId, Date.now());
        return true;
    }
    return false;
}

// =============================================================================
// Security: Per-Account Rate Limiting
// =============================================================================
const accountRateLimits = new Map<string, number[]>(); // accountId -> timestamps
const MAX_EVENTS_PER_MINUTE = 100;

function isRateLimited(accountId: string): boolean {
    const now = Date.now();
    const timestamps = accountRateLimits.get(accountId) || [];

    // Filter to last minute only
    const recent = timestamps.filter(t => now - t < 60000);

    if (recent.length >= MAX_EVENTS_PER_MINUTE) {
        return true;
    }

    recent.push(now);
    accountRateLimits.set(accountId, recent);
    return false;
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [accountId, timestamps] of accountRateLimits.entries()) {
        const recent = timestamps.filter(t => now - t < 60000);
        if (recent.length === 0) {
            accountRateLimits.delete(accountId);
        } else {
            accountRateLimits.set(accountId, recent);
        }
    }
}, 5 * 60 * 1000);



/**
 * DEPRECATED: JavaScript Tracking Script
 * This endpoint is kept for backwards compatibility but returns a no-op.
 * All tracking is now handled server-side via the WordPress plugin.
 * GET /api/tracking/tracking.js
 */
router.get('/tracking.js', (req, res) => {
    const accountId = req.query.id;
    Logger.debug(`Tracking script requested (deprecated)`, { accountId, referer: req.headers.referer || 'none' });

    // Return a no-op script - all tracking is now server-side
    const script = `
// OverSeek: Client-side tracking is deprecated.
// All analytics are now collected server-side via the WordPress plugin.
// This script intentionally does nothing.
(function() {
    // No-op: Server-side tracking is active
})();
    `;

    res.setHeader('Content-Type', 'application/javascript');
    res.send(script);
});

/**
 * public ingestion endpoint
 * POST /api/tracking/events
 */
router.post('/events', async (req, res) => {
    try {
        const { accountId, visitorId, type, url, payload, pageTitle, referrer, utmSource, utmMedium, utmCampaign } = req.body;

        if (!accountId || !visitorId || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Security: Validate account exists (cached)
        const valid = await isValidAccount(accountId);
        if (!valid) {
            return res.status(400).json({ error: 'Invalid account' });
        }

        // Security: Rate limit per account
        if (isRateLimited(accountId)) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        // Log origin for forensics (non-blocking)
        const origin = req.headers.origin || req.headers.referer || 'unknown';

        // Debug: Log incoming event
        Logger.debug(`Tracking event received`, { type, accountId, origin });

        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (Array.isArray(ip)) ip = ip[0];

        const userAgent = req.headers['user-agent'];

        // Process in background if we want faster response?
        // But for "Live" view, we want it indexed.
        await TrackingService.processEvent({
            accountId,
            visitorId,
            type,
            url,
            payload,
            pageTitle,
            ipAddress: ip as string,
            userAgent,
            referrer,
            utmSource,
            utmMedium,
            utmCampaign
        });

        res.json({ success: true });
    } catch (error) {
        Logger.error('Tracking Error', { error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Short alias for /events - avoids "tracking" keyword for ad blocker bypass
// POST /api/tracking/e (or mount as /api/t/e in app.ts)
router.post('/e', async (req, res) => {
    try {
        const { accountId, visitorId, type, url, payload, pageTitle, referrer, utmSource, utmMedium, utmCampaign, userAgent: bodyUserAgent } = req.body;

        if (!accountId || !visitorId || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const valid = await isValidAccount(accountId);
        if (!valid) {
            return res.status(400).json({ error: 'Invalid account' });
        }

        if (isRateLimited(accountId)) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        const origin = req.headers.origin || req.headers.referer || 'unknown';
        Logger.debug(`Tracking event received`, { type, accountId, origin });

        // Get IP from forwarded headers (server-side tracking sends real visitor IP)
        let ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
        if (Array.isArray(ip)) ip = ip[0];
        // If comma-separated, take the first IP
        if (typeof ip === 'string' && ip.includes(',')) {
            ip = ip.split(',')[0].trim();
        }

        // Prefer userAgent from body (sent by WordPress plugin) over headers
        const userAgent = bodyUserAgent || req.headers['user-agent'];

        await TrackingService.processEvent({
            accountId,
            visitorId,
            type,
            url,
            payload,
            pageTitle,
            ipAddress: ip as string,
            userAgent,
            referrer,
            utmSource,
            utmMedium,
            utmCampaign
        });

        res.json({ success: true });
    } catch (error) {
        Logger.error('Tracking Error', { error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================================
// Image Pixel Fallback - For when JS fails or is blocked
// GET /api/t/p.gif?a=accountId&v=visitorId&t=type&u=url
// =============================================================================
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

router.get('/p.gif', async (req, res) => {
    try {
        const { a: accountId, v: visitorId, t: type, u: url, p: payloadStr } = req.query;

        if (!accountId || !visitorId || !type) {
            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(TRANSPARENT_GIF);
        }

        // Validate account
        const valid = await isValidAccount(accountId as string);
        if (!valid) {
            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(TRANSPARENT_GIF);
        }

        // Rate limit check
        if (isRateLimited(accountId as string)) {
            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(TRANSPARENT_GIF);
        }

        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (Array.isArray(ip)) ip = ip[0];

        let payload = {};
        if (payloadStr) {
            try {
                payload = JSON.parse(decodeURIComponent(payloadStr as string));
            } catch (e) { }
        }

        Logger.debug(`Tracking pixel event`, { type, accountId });

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

        // Return transparent 1x1 GIF
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

// --------------------------------------------------------
// Dashboard Routes (Protected)
// --------------------------------------------------------

// Middleware to get current account context
// Usually passed as header x-account-id or part of query?
// In this app, we usually have `req.user` and we need to check permission for account.
// I'll assume standard pattern: authenticateToken + check account ownership.

router.get('/live', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'];
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const visitors = await TrackingService.getLiveVisitors(accountId as string);
        res.json(visitors);
    } catch (error) {
        Logger.error('Live Users Error', { error });
        res.status(500).json({ error: 'Failed to fetch live users' });
    }
});

router.get('/carts', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'];
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const carts = await TrackingService.getLiveCarts(accountId as string);
        res.json(carts);
    } catch (error) {
        Logger.error('Live Carts Error', { error });
        res.status(500).json({ error: 'Failed to fetch live carts' });
    }
});

router.get('/session/:sessionId', requireAuth, async (req: any, res) => {
    try {
        const history = await TrackingService.getSessionHistory(req.params.sessionId);
        res.json(history);
    } catch (error) {
        Logger.error('Session History Error', { error });
        res.status(500).json({ error: 'Failed to fetch session history' });
    }
});

router.get('/status', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const lastSession = await prisma.analyticsSession.findFirst({
            where: { accountId },
            orderBy: { lastActiveAt: 'desc' },
            select: { lastActiveAt: true }
        });

        res.json({
            connected: !!lastSession,
            lastSignal: lastSession?.lastActiveAt || null
        });
    } catch (error) {
        Logger.error('Status Check Error', { error });
        res.status(500).json({ error: 'Failed to check status' });
    }
});

/**
 * GET /api/tracking/verify-store
 * Pings the WooCommerce store to verify plugin installation and configuration.
 */
router.get('/verify-store', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        // Get the store URL from account settings
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { wooUrl: true, name: true }
        });

        if (!account?.wooUrl) {
            return res.json({
                success: false,
                error: 'No store URL configured',
                storeReachable: false,
                pluginInstalled: false
            });
        }

        // Try to ping the store's health check endpoint
        const healthUrl = `${account.wooUrl}/wp-json/overseek/v1/health?account_id=${accountId}`;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            const response = await fetch(healthUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                // Store reachable but endpoint not found (plugin not installed)
                if (response.status === 404) {
                    return res.json({
                        success: false,
                        storeUrl: account.wooUrl,
                        storeReachable: true,
                        pluginInstalled: false,
                        error: 'OverSeek plugin not detected. Please install and activate the plugin.'
                    });
                }

                return res.json({
                    success: false,
                    storeUrl: account.wooUrl,
                    storeReachable: true,
                    pluginInstalled: false,
                    error: `Store returned status ${response.status}`
                });
            }

            const data = await response.json() as {
                success: boolean;
                plugin: string;
                version: string;
                configured: boolean;
                accountId: string | null;
                accountMatch: boolean;
                trackingEnabled: boolean;
                chatEnabled: boolean;
                woocommerceActive: boolean;
                woocommerceVersion: string | null;
            };

            // Plugin is installed - check configuration
            return res.json({
                success: true,
                storeUrl: account.wooUrl,
                storeName: account.name,
                storeReachable: true,
                pluginInstalled: true,
                pluginVersion: data.version || 'unknown',
                configured: data.configured,
                accountMatch: data.accountMatch,
                trackingEnabled: data.trackingEnabled,
                chatEnabled: data.chatEnabled,
                woocommerceActive: data.woocommerceActive,
                woocommerceVersion: data.woocommerceVersion
            });

        } catch (fetchError: any) {
            if (fetchError.name === 'AbortError') {
                return res.json({
                    success: false,
                    storeUrl: account.wooUrl,
                    storeReachable: false,
                    pluginInstalled: false,
                    error: 'Connection timed out. Store may be unreachable or slow.'
                });
            }

            return res.json({
                success: false,
                storeUrl: account.wooUrl,
                storeReachable: false,
                pluginInstalled: false,
                error: `Failed to connect to store: ${fetchError.message}`
            });
        }

    } catch (error) {
        Logger.error('Store Verification Error', { error });
        res.status(500).json({ error: 'Failed to verify store connection' });
    }
});

// --------------------------------------------------------
// Analytics Stats & Funnel Endpoints
// --------------------------------------------------------

/**
 * GET /api/tracking/stats
 * Returns aggregated stats: countries, devices, browsers, avg session duration
 */
router.get('/stats', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const days = parseInt(req.query.days as string) || 30;
        const stats = await TrackingService.getStats(accountId, days);

        res.json(stats);
    } catch (error) {
        Logger.error('Stats Error', { error });
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

/**
 * GET /api/tracking/funnel
 * Returns funnel data: Product Views → Add to Cart → Checkout → Purchase
 */
router.get('/funnel', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const days = parseInt(req.query.days as string) || 30;
        const funnel = await TrackingService.getFunnel(accountId, days);

        res.json(funnel);
    } catch (error) {
        Logger.error('Funnel Error', { error });
        res.status(500).json({ error: 'Failed to fetch funnel' });
    }
});

// --------------------------------------------------------
// Advanced Analytics Endpoints
// --------------------------------------------------------

/**
 * GET /api/tracking/revenue
 * Revenue analytics: AOV, by source, country, device
 */
router.get('/revenue', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const days = parseInt(req.query.days as string) || 30;
        const revenue = await TrackingService.getRevenue(accountId, days);

        res.json(revenue);
    } catch (error) {
        Logger.error('Revenue Error', { error });
        res.status(500).json({ error: 'Failed to fetch revenue' });
    }
});

/**
 * GET /api/tracking/attribution
 * First-touch vs last-touch attribution
 */
router.get('/attribution', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const days = parseInt(req.query.days as string) || 30;
        const attribution = await TrackingService.getAttribution(accountId, days);

        res.json(attribution);
    } catch (error) {
        Logger.error('Attribution Error', { error });
        res.status(500).json({ error: 'Failed to fetch attribution' });
    }
});

/**
 * GET /api/tracking/abandonment
 * Cart abandonment rate
 */
router.get('/abandonment', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const days = parseInt(req.query.days as string) || 30;
        const abandonment = await TrackingService.getAbandonmentRate(accountId, days);

        res.json(abandonment);
    } catch (error) {
        Logger.error('Abandonment Error', { error });
        res.status(500).json({ error: 'Failed to fetch abandonment' });
    }
});

/**
 * GET /api/tracking/searches
 * Search analytics: top queries
 */
router.get('/searches', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const days = parseInt(req.query.days as string) || 30;
        const searches = await TrackingService.getSearches(accountId, days);

        res.json(searches);
    } catch (error) {
        Logger.error('Searches Error', { error });
        res.status(500).json({ error: 'Failed to fetch searches' });
    }
});

/**
 * GET /api/tracking/exits
 * Exit pages: where users leave
 */
router.get('/exits', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const days = parseInt(req.query.days as string) || 30;
        const exits = await TrackingService.getExitPages(accountId, days);

        res.json(exits);
    } catch (error) {
        Logger.error('Exits Error', { error });
        res.status(500).json({ error: 'Failed to fetch exits' });
    }
});

/**
 * GET /api/tracking/cohorts
 * Cohort analysis: retention by signup week
 */
router.get('/cohorts', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const cohorts = await TrackingService.getCohorts(accountId);

        res.json(cohorts);
    } catch (error) {
        Logger.error('Cohorts Error', { error });
        res.status(500).json({ error: 'Failed to fetch cohorts' });
    }
});

/**
 * GET /api/tracking/ltv
 * Customer Lifetime Value analytics
 */
router.get('/ltv', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const ltv = await TrackingService.getLTV(accountId);

        res.json(ltv);
    } catch (error) {
        Logger.error('LTV Error', { error });
        res.status(500).json({ error: 'Failed to fetch LTV' });
    }
});

/**
 * GET /api/tracking/export
 * Export analytics data as JSON
 */
router.get('/export', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const days = parseInt(req.query.days as string) || 30;

        // Gather all analytics data
        const [stats, funnel, revenue, attribution, abandonment, cohorts, ltv] = await Promise.all([
            TrackingService.getStats(accountId, days),
            TrackingService.getFunnel(accountId, days),
            TrackingService.getRevenue(accountId, days),
            TrackingService.getAttribution(accountId, days),
            TrackingService.getAbandonmentRate(accountId, days),
            TrackingService.getCohorts(accountId),
            TrackingService.getLTV(accountId)
        ]);

        const exportData = {
            exportedAt: new Date().toISOString(),
            dateRange: `Last ${days} days`,
            stats,
            funnel,
            revenue,
            attribution,
            abandonment,
            cohorts,
            ltv
        };

        res.setHeader('Content-Disposition', `attachment; filename="analytics-export-${new Date().toISOString().split('T')[0]}.json"`);
        res.json(exportData);
    } catch (error) {
        Logger.error('Export Error', { error });
        res.status(500).json({ error: 'Failed to export data' });
    }
});

/**
 * POST /api/tracking/custom
 * Custom events endpoint for merchants
 */
router.post('/custom', async (req, res) => {
    try {
        const { accountId, visitorId, eventName, properties } = req.body;

        if (!accountId || !visitorId || !eventName) {
            return res.status(400).json({ error: 'Missing required fields: accountId, visitorId, eventName' });
        }

        await TrackingService.processEvent({
            accountId,
            visitorId,
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
