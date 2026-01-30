/**
 * Event processing service for incoming tracking events.
 *
 * Handles session upsert, event logging, attribution tracking,
 * and cart state management for analytics sessions.
 */

import { prisma } from '../../utils/prisma';
import { geoipLookupSync } from './GeoIPService';
import { parseTrafficSource, isBot, maskIpAddress } from './TrafficAnalyzer';
import { isExcludedIp } from './IpExclusionService';

const UAParser = require('ua-parser-js');

/**
 * Payload structure for incoming tracking events.
 */
export interface TrackingEventPayload {
    accountId: string;
    visitorId: string;
    type: string;
    url: string;
    pageTitle?: string;
    payload?: any;

    // Context (sent on first hit or if changed)
    ipAddress?: string;
    userAgent?: string;
    referrer?: string;
    referrerDomain?: string;  // Pre-parsed domain from plugin (optimization)
    referrerType?: string;    // Pre-classified type: 'direct', 'organic', 'social', 'referral', 'internal'
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;

    // Page metadata
    is404?: boolean;

    // Ad platform click IDs (gclid, fbclid, msclkid, etc.)
    clickId?: string;      // The raw click ID value
    clickPlatform?: string; // Platform: 'google', 'facebook', 'microsoft', 'tiktok', 'twitter', 'linkedin', 'pinterest'

    // Landing page referrer (persisted original external referrer)
    landingReferrer?: string;

    // Session enrichment from logged-in users (for session stitching)
    customerId?: number;
    email?: string;
}

/**
 * Process an incoming tracking event.
 *
 * This method handles:
 * - Bot filtering
 * - GeoIP resolution
 * - Session upsert with device/browser detection
 * - Cart state updates
 * - Session stitching (linking visitors to customers)
 * - First-touch and last-touch attribution
 * - Event logging
 *
 * @param data - The tracking event payload
 * @returns The upserted session, or null if filtered (bot traffic)
 */
export async function processEvent(data: TrackingEventPayload) {
    // Filter out bots/crawlers - they shouldn't be tracked
    if (data.userAgent && isBot(data.userAgent)) {
        return null; // Silently skip bot traffic
    }

    // Filter out excluded IPs (admins, team members, etc.)
    if (data.ipAddress && await isExcludedIp(data.accountId, data.ipAddress)) {
        return null; // Silently skip excluded IP traffic
    }

    // Filter out non-page URLs for pageview events (e.g. static assets)
    // These should not be tracked as page views
    if (data.type === 'pageview' && data.url) {
        const urlPath = data.url.toLowerCase();
        // Common static asset extensions that shouldn't be tracked as page views
        const staticAssetExtensions = [
            '.js', '.css', '.map',
            '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp', '.avif',
            '.woff', '.woff2', '.ttf', '.eot', '.otf',
            '.mp4', '.webm', '.mp3', '.ogg', '.wav',
            '.pdf', '.doc', '.docx', '.xls', '.xlsx',
            '.zip', '.tar', '.gz', '.rar',
            '.xml', '.json'
        ];

        // Check if URL ends with a static asset extension (ignore query strings)
        const pathWithoutQuery = urlPath.split('?')[0];
        const isStaticAsset = staticAssetExtensions.some(ext => pathWithoutQuery.endsWith(ext));

        if (isStaticAsset) {
            return null; // Silently skip static asset requests
        }
    }

    // 1. Resolve GeoIP if IP is provided
    let country: string | null = null;
    let city: string | null = null;
    let region: string | null = null;

    if (data.ipAddress) {
        const geo = geoipLookupSync(data.ipAddress);
        if (geo) {
            country = geo.country;
            city = geo.city;
            region = geo.region;
        }
    }

    // 2. Upsert Session
    // We use visitorId + accountId as the unique key.
    // We update the "Live State" fields.

    const sessionPayload: any = {
        lastActiveAt: new Date(),
        currentPath: data.url
    };

    // Mask IP before storing for privacy (hide last octet for IPv4, last 80 bits for IPv6)
    if (data.ipAddress) sessionPayload.ipAddress = maskIpAddress(data.ipAddress);
    if (data.userAgent) sessionPayload.userAgent = data.userAgent;
    if (country) sessionPayload.country = country;
    if (city) sessionPayload.city = city;

    // Attribution (only set if not exists, or maybe overwrite if it's a new campaign?)
    // For simplicity, we'll strip falsy values to avoid overwriting with null if the client didn't send them this time
    if (data.referrer) {
        sessionPayload.referrer = data.referrer;
        // Note: trafficSource is tracked via firstTouchSource/lastTouchSource fields
    }
    if (data.utmSource) sessionPayload.utmSource = data.utmSource;
    if (data.utmMedium) sessionPayload.utmMedium = data.utmMedium;
    if (data.utmCampaign) sessionPayload.utmCampaign = data.utmCampaign;

    // Parse User Agent with ua-parser-js for accurate detection
    if (data.userAgent) {
        const parser = new UAParser();
        const result = parser.setUA(data.userAgent).getResult();

        // Device type
        const deviceType = result.device.type;
        if (deviceType === 'mobile') {
            sessionPayload.deviceType = 'mobile';
        } else if (deviceType === 'tablet') {
            sessionPayload.deviceType = 'tablet';
        } else {
            sessionPayload.deviceType = 'desktop';
        }

        // Browser
        if (result.browser.name) {
            sessionPayload.browser = result.browser.name;
        }

        // OS
        if (result.os.name) {
            sessionPayload.os = result.os.name;
        }
    }

    // Handle Cart updates
    if (data.type === 'add_to_cart' || data.type === 'remove_from_cart' || data.type === 'update_cart') {
        // Expect payload to have cartTotal and items
        // Support common aliases for value: total, value, price, amount
        const payloadTotal = data.payload.total ?? data.payload.value ?? data.payload.price ?? data.payload.amount;

        if (data.payload && typeof payloadTotal !== 'undefined') {
            sessionPayload.cartValue = payloadTotal;
            sessionPayload.currency = data.payload.currency || 'USD';

            // Only update items if the full list is provided. 
            // Otherwise we risk wiping the list on simple 'add_to_cart' events that only send totals.
            if (Array.isArray(data.payload.items)) {
                sessionPayload.cartItems = data.payload.items;
            }

            // Reset abandoned status if they interact with cart
            sessionPayload.abandonedNotificationSentAt = null;
        }
    }

    // If checkout start, link email
    if (data.type === 'checkout_start' && data.payload?.email) {
        sessionPayload.email = data.payload.email;
    }

    // If checkout success or purchase, clear cart and mark as converted
    if (data.type === 'checkout_success' || data.type === 'purchase') {
        sessionPayload.cartValue = 0;
        sessionPayload.cartItems = [];
        sessionPayload.abandonedNotificationSentAt = null;
    }

    // Capture email from purchase event if not already set on session
    if (data.type === 'purchase' && data.payload?.email) {
        sessionPayload.email = data.payload.email;
    }

    // Handle Search (Just ensure payload has term)
    if (data.type === 'search') {
        // validating payload.term exists?
        // checking if we want to update session 'lastSearchTerm'?
    }

    // Session Stitching: Link visitor to customer on login
    if (data.type === 'identify') {
        const payloadCustomerId = data.payload?.customerId ?? data.payload?.id ?? data.payload?.userId;

        if (payloadCustomerId) {
            // wooCustomerId is an Int in the schema
            sessionPayload.wooCustomerId = parseInt(String(payloadCustomerId), 10) || null;
            if (data.payload.email) {
                sessionPayload.email = data.payload.email;
            }
            // Note: firstName and lastName are not stored on AnalyticsSession
            // They should be looked up from WooCustomer if needed
        }
    }

    // Product View: Store detailed product data
    if (data.type === 'product_view' && data.payload?.productId) {
        // This is logged as an event with rich product data
        // The payload should include: productId, productName, price, sku, category
    }

    // A/B Test: Store experiment variation
    if (data.type === 'experiment' && data.payload?.experimentId) {
        // Log experiment assignment for later analysis
        // payload: { experimentId, variationId }
    }

    // Check if returning visitor (exists in DB already)
    // Include lastTouchSource to preserve attribution during internal navigation
    const existingSession = await prisma.analyticsSession.findUnique({
        where: {
            accountId_visitorId: {
                accountId: data.accountId,
                visitorId: data.visitorId
            }
        },
        select: {
            id: true,
            firstTouchSource: true,
            firstTouchAt: true,
            totalVisits: true,
            lastTouchSource: true
        }
    });

    // Note: isReturning is computed, not stored in DB
    // We can derive it from totalVisits > 0 if needed

    // Attribution tracking
    // Priority: 1) Click ID (paid ads), 2) UTM source, 3) Landing referrer, 4) Current referrer, 5) Direct
    let currentSource = 'direct';
    let campaignInfo = '';

    // Priority 1: Click ID from ad platforms (gclid, fbclid, msclkid, etc.)
    if (data.clickId && data.clickPlatform) {
        currentSource = 'paid';
        campaignInfo = data.clickPlatform;
        // Store click platform in session for attribution
        sessionPayload.utmSource = data.clickPlatform;
        sessionPayload.utmMedium = 'cpc';
    }
    // Priority 2: Explicit UTM parameters
    else if (data.utmSource) {
        // Map common UTM sources to our traffic categories
        const utmLower = data.utmSource.toLowerCase();
        if (['google', 'bing', 'yahoo', 'duckduckgo', 'baidu'].includes(utmLower)) {
            // Check if it's paid (usually has utm_medium=cpc/ppc) or organic
            currentSource = (data.utmMedium?.toLowerCase() === 'cpc' || data.utmMedium?.toLowerCase() === 'ppc')
                ? 'paid' : 'organic';
        } else if (['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'pinterest', 'youtube', 'reddit'].includes(utmLower)) {
            currentSource = 'social';
        } else if (['email', 'newsletter', 'mailchimp', 'klaviyo'].includes(utmLower)) {
            currentSource = 'email';
        } else if (['chatgpt', 'openai', 'claude', 'perplexity', 'bard', 'gemini'].includes(utmLower)) {
            currentSource = 'ai';
        } else {
            // Has UTM but unknown source - treat as campaign/referral
            currentSource = 'campaign';
        }
    }
    // Priority 3: Landing referrer (persisted original external referrer)
    else if (data.landingReferrer) {
        currentSource = parseTrafficSource(data.landingReferrer);
        // Store landing referrer if not already set
        if (!sessionPayload.referrer) {
            sessionPayload.referrer = data.landingReferrer;
            // Note: trafficSource is derived from firstTouchSource/lastTouchSource, not stored separately
        }
    }
    // Priority 4: Current page referrer
    else if (data.referrer) {
        // Use pre-computed referrerType from plugin if available (optimization)
        // Otherwise fall back to parsing on the server (for legacy clients or JS trackers)
        if (data.referrerType && data.referrerType !== 'internal') {
            // Map plugin types to our internal types
            const typeMap: Record<string, string> = {
                'organic': 'organic',
                'social': 'social',
                'referral': 'referral',
                'direct': 'direct'
            };
            currentSource = typeMap[data.referrerType] || parseTrafficSource(data.referrer);
        } else if (data.referrerType === 'internal') {
            // Internal referrer = same site navigation, preserve existing session's source
            currentSource = existingSession?.lastTouchSource || 'direct';
        } else {
            // No pre-computed type, fall back to server-side parsing
            // Preserve existing session's source if parsing returns 'direct' (same-site or empty referrer)
            const parsedSource = parseTrafficSource(data.referrer);
            currentSource = parsedSource === 'direct'
                ? (existingSession?.lastTouchSource || 'direct')
                : parsedSource;
        }
    }
    // If none of the above, stays 'direct'

    // Session enrichment from logged-in users (top-level fields from server-side tracking)
    if (data.customerId) {
        sessionPayload.wooCustomerId = data.customerId;
    }
    if (data.email && !sessionPayload.email) {
        sessionPayload.email = data.email;
    }

    // First touch - only set once, never overwrite
    if (!existingSession?.firstTouchSource) {
        sessionPayload.firstTouchSource = currentSource;
        sessionPayload.firstTouchAt = new Date();
    }

    // Last touch - always update
    sessionPayload.lastTouchSource = currentSource;
    sessionPayload.lastTouchAt = new Date();

    // Increment visit count for page-based events
    // Includes standard pageview plus specialized page events (product_view, cart_view, checkout_view)
    // which are sent instead of pageview for richer analytics data
    const pageViewTypes = ['pageview', 'product_view', 'cart_view', 'checkout_view'];
    const isPageView = pageViewTypes.includes(data.type);
    sessionPayload.totalVisits = (existingSession?.totalVisits || 0) + (isPageView ? 1 : 0);

    // Upsert session
    const session = await prisma.analyticsSession.upsert({
        where: {
            accountId_visitorId: {
                accountId: data.accountId,
                visitorId: data.visitorId
            }
        },
        create: {
            accountId: data.accountId,
            visitorId: data.visitorId,
            firstTouchSource: currentSource,
            firstTouchAt: new Date(),
            ...sessionPayload
        },
        update: sessionPayload
    });

    // 3. Visit Management
    // Check if we need to create a new visit (30 min inactivity gap)
    const VISIT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const now = new Date();

    // Get the most recent visit for this session
    let currentVisit = await prisma.analyticsVisit.findFirst({
        where: { sessionId: session.id },
        orderBy: { startedAt: 'desc' },
        select: {
            id: true,
            visitNumber: true,
            endedAt: true,
            pageviews: true,
            actions: true
        }
    });

    const timeSinceLastActivity = currentVisit
        ? now.getTime() - new Date(currentVisit.endedAt).getTime()
        : Infinity;

    // Create new visit if: no existing visit OR 30+ min gap
    if (!currentVisit || timeSinceLastActivity > VISIT_TIMEOUT_MS) {
        const visitNumber = currentVisit ? currentVisit.visitNumber + 1 : 1;

        currentVisit = await prisma.analyticsVisit.create({
            data: {
                sessionId: session.id,
                visitNumber,
                startedAt: now,
                endedAt: now,
                referrer: sessionPayload.referrer || data.referrer,
                utmSource: sessionPayload.utmSource || data.utmSource,
                utmMedium: sessionPayload.utmMedium || data.utmMedium,
                utmCampaign: sessionPayload.utmCampaign || data.utmCampaign,
                deviceType: sessionPayload.deviceType,
                browser: sessionPayload.browser,
                os: sessionPayload.os,
                country: sessionPayload.country || country,
                city: sessionPayload.city || city,
                pageviews: isPageView ? 1 : 0,
                actions: 1
            },
            select: {
                id: true,
                visitNumber: true,
                endedAt: true,
                pageviews: true,
                actions: true
            }
        });
    } else {
        // Update existing visit stats
        await prisma.analyticsVisit.update({
            where: { id: currentVisit.id },
            data: {
                endedAt: now,
                pageviews: { increment: isPageView ? 1 : 0 },
                actions: { increment: 1 }
            }
        });
    }

    // 4. Log Event with visit link
    // Build payload, merging is404 flag for pageview events
    let eventPayload = data.payload || undefined;
    if (data.type === 'pageview' && data.is404) {
        eventPayload = { ...(data.payload || {}), is404: true };
    }

    try {
        await prisma.analyticsEvent.create({
            data: {
                sessionId: session.id,
                visitId: currentVisit.id,
                type: data.type,
                url: data.url,
                pageTitle: data.pageTitle,
                payload: eventPayload
            }
        });
    } catch (eventError: any) {
        console.error('Prisma event create error:', eventError.message || eventError);
        console.error('Event data was:', { sessionId: session.id, visitId: currentVisit.id, type: data.type, url: data.url, pageTitle: data.pageTitle });
        throw eventError;
    }

    return session;
}
