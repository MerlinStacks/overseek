
import express from 'express';
import { TrackingService } from '../services/TrackingService';
import { prisma } from '../utils/prisma';
import { verifyToken } from '../utils/auth';

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
 * Serve Tracking Script
 * GET /api/tracking/tracking.js
 */
router.get('/tracking.js', (req, res) => {
    const script = `
(function() {
    const API_URL = '${process.env.API_URL || "https://api.overseek.com"}/api/tracking/events'; // Adjust based on env
    // Actually, since we are serving it, we can just use the origin relative to where it was loaded, 
    // IF the script is loaded from the same domain. But it's on a woocommerce site.
    // So we need the absolute URL of THIS server.
    // We can infer it from the request if not set.
    const ENDPOINT = window.location.protocol + '//' + '${req.get('host')}' + '/api/tracking/events';

    // Helper: Generate UUID
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Helper: Get/Set Cookie
    function getCookie(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        if (match) return match[2];
    }
    function setCookie(name, value, days) {
        var expires = "";
        if (days) {
            var date = new Date();
            date.setTime(date.getTime() + (days*24*60*60*1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "")  + expires + "; path=/";
    }

    // 1. Initialize Visitor ID
    let visitorId = getCookie('_os_vid');
    if (!visitorId) {
        visitorId = generateUUID();
        setCookie('_os_vid', visitorId, 365);
    }

    // Get Account ID from URL query param
    const scriptTag = document.currentScript;
    const urlParams = new URLSearchParams(scriptTag.src.split('?')[1]);
    const accountId = urlParams.get('id');

    if (!accountId) {
        console.warn('OverSeek: Account ID missing');
        return;
    }

    // 2. Send Event
    function sendEvent(type, payload = {}) {
        const data = {
            accountId,
            visitorId,
            type,
            url: window.location.href,
            pageTitle: document.title,
            referrer: document.referrer,
            payload
        };

        // Capture UTMs
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('utm_source')) data.utmSource = urlParams.get('utm_source');
        if (urlParams.has('utm_medium')) data.utmMedium = urlParams.get('utm_medium');
        if (urlParams.has('utm_campaign')) data.utmCampaign = urlParams.get('utm_campaign');

        // Use Beacon if available for guaranteed delivery on unload, else fetch/xhr
        if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            navigator.sendBeacon(ENDPOINT, blob);
        } else {
            fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).catch(e => console.error(e));
        }
    }

    // 3. Track Pageview
    sendEvent('pageview');

    // 4. WooCommerce Events (jQuery)
    if (typeof jQuery !== 'undefined') {
        jQuery(document.body).on('added_to_cart', function(e, fragments, cart_hash, button) {
            let total = 0;
            // Capture Product ID and Quantity
            let productId = null;
            let quantity = 1;

            if (button && button.length) {
                productId = button.data('product_id');
                quantity = button.data('quantity') || 1;
            }

            try {
                // Attempt 1: Parse from fragments if available
                if (fragments && fragments['div.widget_shopping_cart_content']) {
                    const div = document.createElement('div');
                    div.innerHTML = fragments['div.widget_shopping_cart_content'];
                    // Try common selectors for subtotal
                    const amountEl = div.querySelector('.woocommerce-mini-cart__total .amount') || 
                                     div.querySelector('.total .amount');
                    if (amountEl) {
                         const text = amountEl.textContent || '';
                         const clean = text.replace(/[^0-9.]/g, '');
                         total = parseFloat(clean) || 0;
                    }
                }
            } catch (err) {
                console.error('OverSeek: Error parsing cart', err);
            }
             
            sendEvent('add_to_cart', { total: total, productId: productId, quantity: quantity });
        });

        jQuery(document.body).on('removed_from_cart', function(e, fragments, cart_hash, button) {
            // Similar logic for removal
            setTimeout(() => {
                let total = 0;
                const amountEl = document.querySelector('.woocommerce-mini-cart__total .amount') || 
                                 document.querySelector('.total .amount');
                if (amountEl) {
                     const text = amountEl.textContent || '';
                     const clean = text.replace(/[^0-9.]/g, '');
                     total = parseFloat(clean) || 0;
                }
                sendEvent('remove_from_cart', { total: total });
            }, 500);
        });

    // 5. Checkout Email Capture (Abandoned Cart)
    const emailField = document.querySelector('input#billing_email');
    if (emailField) {
        emailField.addEventListener('blur', function(e) {
            const email = e.target.value;
            if (email && email.includes('@')) {
                 sendEvent('checkout_start', { email: email });
            }
        });
        
        // Also capture on change if they use autofill
        emailField.addEventListener('change', function(e) {
             const email = e.target.value;
             if (email && email.includes('@')) {
                  sendEvent('checkout_start', { email: email });
             }
        });
    }

    // Periodic Heartbeat (keep session alive)
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            sendEvent('heartbeat');
        }
    }, 30000);

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
        console.error('Tracking Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
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
        console.error('Live Users Error:', error);
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
        console.error('Live Carts Error:', error);
        res.status(500).json({ error: 'Failed to fetch live carts' });
    }
});

router.get('/session/:sessionId', requireAuth, async (req: any, res) => {
    try {
        const history = await TrackingService.getSessionHistory(req.params.sessionId);
        res.json(history);
    } catch (error) {
        console.error('Session History Error:', error);
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
        console.error('Status Check Error:', error);
        res.status(500).json({ error: 'Failed to check status' });
    }
});

export default router;
