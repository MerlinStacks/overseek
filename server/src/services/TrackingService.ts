
import { prisma } from '../utils/prisma';
import geoip from 'geoip-lite';
const UAParser = require('ua-parser-js');

interface TrackingEventPayload {
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
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
}

export class TrackingService {

    static async processEvent(data: TrackingEventPayload) {
        // Filter out bots/crawlers - they shouldn't be tracked
        if (data.userAgent && TrackingService.isBot(data.userAgent)) {
            return null; // Silently skip bot traffic
        }

        // 1. Resolve GeoIP if IP is provided
        let country = null;
        let city = null;
        let region = null;

        if (data.ipAddress) {
            const geo = geoip.lookup(data.ipAddress);
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
        if (data.ipAddress) sessionPayload.ipAddress = TrackingService.maskIpAddress(data.ipAddress);
        if (data.userAgent) sessionPayload.userAgent = data.userAgent;
        if (country) sessionPayload.country = country;
        if (city) sessionPayload.city = city;

        // Attribution (only set if not exists, or maybe overwrite if it's a new campaign?)
        // For simplicity, we'll strip falsy values to avoid overwriting with null if the client didn't send them this time
        if (data.referrer) {
            sessionPayload.referrer = data.referrer;
            sessionPayload.trafficSource = TrackingService.parseTrafficSource(data.referrer);
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
            if (data.payload && typeof data.payload.total !== 'undefined') {
                sessionPayload.cartValue = data.payload.total;
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
        if (data.type === 'identify' && data.payload?.customerId) {
            // wooCustomerId is an Int in the schema
            sessionPayload.wooCustomerId = parseInt(String(data.payload.customerId), 10) || null;
            if (data.payload.email) {
                sessionPayload.email = data.payload.email;
            }
            // Note: firstName and lastName are not stored on AnalyticsSession
            // They should be looked up from WooCustomer if needed
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
                totalVisits: true
            }
        });

        // Note: isReturning is computed, not stored in DB
        // We can derive it from totalVisits > 0 if needed

        // Attribution tracking
        // Priority: 1) UTM source (most explicit), 2) Referrer-based source, 3) Direct
        let currentSource = 'direct';

        if (data.utmSource) {
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
        } else if (data.referrer) {
            // No UTM, fall back to referrer parsing
            currentSource = sessionPayload.trafficSource || TrackingService.parseTrafficSource(data.referrer);
        }
        // If neither UTM nor referrer, stays 'direct'

        // First touch - only set once, never overwrite
        if (!existingSession?.firstTouchSource) {
            sessionPayload.firstTouchSource = currentSource;
            sessionPayload.firstTouchAt = new Date();
        }

        // Last touch - always update
        sessionPayload.lastTouchSource = currentSource;
        sessionPayload.lastTouchAt = new Date();

        // Increment visit count
        sessionPayload.totalVisits = (existingSession?.totalVisits || 0) + (data.type === 'pageview' ? 1 : 0);

        // Upsert
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

        // 3. Log Event
        await prisma.analyticsEvent.create({
            data: {
                sessionId: session.id,
                type: data.type,
                url: data.url,
                pageTitle: data.pageTitle,
                payload: data.payload || undefined
            }
        });

        return session;
    }

    /**
     * Get Live Visitors (Active in last 3 mins)
     * Filters out bots and sessions without userAgent
     */
    static async getLiveVisitors(accountId: string) {
        const threeMinsAgo = new Date(Date.now() - 3 * 60 * 1000);

        const sessions = await prisma.analyticsSession.findMany({
            where: {
                accountId,
                lastActiveAt: {
                    gte: threeMinsAgo
                },
                // Exclude sessions with no userAgent (likely bots or server-side requests)
                userAgent: {
                    not: null
                }
            },
            orderBy: {
                lastActiveAt: 'desc'
            },
            take: 100 // Fetch more initially, we'll filter further
        });

        // Post-filter to catch any bots that slipped through ingestion
        // (e.g., sessions created before bot detection was enhanced)
        const filteredSessions = sessions.filter(session => {
            if (!session.userAgent) return false;
            return !TrackingService.isBot(session.userAgent);
        });

        return filteredSessions.slice(0, 50); // Cap at 50 for live view
    }

    /**
     * Get Active Carts (Live sessions with cart items)
     */
    static async getLiveCarts(accountId: string) {
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000); // Or maybe longer for carts? 24h?
        // Let's stick to "Live" context, maybe 1 hour.
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        return prisma.analyticsSession.findMany({
            where: {
                accountId,
                cartValue: {
                    gt: 0
                },
                lastActiveAt: {
                    gte: oneHourAgo
                }
            },
            orderBy: {
                cartValue: 'desc'
            }
        });
    }

    /**
     * Get Session History
     */
    static async getSessionHistory(sessionId: string) {
        return prisma.analyticsEvent.findMany({
            where: { sessionId },
            orderBy: { createdAt: 'desc' }
        });
    }

    /**
     * Find Abandoned Carts
     * Sessions with cartValue > 0, email set, inactive for X mins, not yet notified
     */
    static async findAbandonedCarts(accountId: string, thresholdMinutes: number = 30) {
        const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

        return prisma.analyticsSession.findMany({
            where: {
                accountId,
                cartValue: { gt: 0 },
                email: { not: null },
                lastActiveAt: { lt: cutoff },
                abandonedNotificationSentAt: null
            }
        });
    }

    static async markAbandonedNotificationSent(sessionId: string) {
        return prisma.analyticsSession.update({
            where: { id: sessionId },
            data: { abandonedNotificationSentAt: new Date() }
        });
    }

    /**
     * Parse referrer URL to determine traffic source category
     */
    static parseTrafficSource(referrer: string): string {
        if (!referrer) return 'direct';

        try {
            const url = new URL(referrer);
            const domain = url.hostname.toLowerCase();

            // Organic Search Engines
            const searchEngines = [
                'google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.', 'yandex.',
                'ecosia.', 'ask.com', 'aol.', 'startpage.', 'qwant.', 'brave.',
                'search.', 'naver.', 'daum.', 'sogou.'
            ];
            if (searchEngines.some(se => domain.includes(se))) {
                return 'organic';
            }

            // AI Providers / AI-Assisted Search
            const aiProviders = [
                'chat.openai.', 'openai.', 'chatgpt.',
                'claude.ai', 'anthropic.',
                'bard.google.', 'gemini.google.',
                'perplexity.ai', 'perplexity.',
                'you.com', 'phind.com',
                'copilot.microsoft.', 'bing.com/chat',
                'poe.com', 'character.ai',
                'huggingface.', 'replicate.',
                'jasper.ai', 'writesonic.', 'copy.ai'
            ];
            if (aiProviders.some(ai => domain.includes(ai) || referrer.includes(ai))) {
                return 'ai';
            }

            // Social Media
            const socialPlatforms = [
                'facebook.', 'fb.com', 'fb.me', 'instagram.',
                'twitter.', 'x.com', 't.co',
                'linkedin.', 'pinterest.', 'tiktok.', 'youtube.', 'youtu.be',
                'reddit.', 'snapchat.', 'threads.', 'mastodon.',
                'tumblr.', 'quora.', 'medium.', 'substack.',
                'discord.', 'twitch.', 'vimeo.'
            ];
            if (socialPlatforms.some(sp => domain.includes(sp))) {
                return 'social';
            }

            // Email Providers
            const emailDomains = [
                'mail.google.', 'outlook.', 'mail.yahoo.',
                'mail.aol.', 'protonmail.', 'zoho.mail',
                'mailchimp.', 'campaign-archive', 'list-manage.',
                'sendgrid.', 'mailgun.', 'constantcontact.'
            ];
            if (emailDomains.some(ed => domain.includes(ed))) {
                return 'email';
            }

            // Shopping / Marketplaces
            const shopping = [
                'amazon.', 'ebay.', 'etsy.', 'alibaba.', 'aliexpress.',
                'shopify.', 'walmart.', 'target.', 'bestbuy.'
            ];
            if (shopping.some(s => domain.includes(s))) {
                return 'marketplace';
            }

            // News / Content
            const news = [
                'news.google.', 'news.yahoo.', 'flipboard.',
                'feedly.', 'pocket.', 'getpocket.',
                'hackernews', 'ycombinator.'
            ];
            if (news.some(n => domain.includes(n))) {
                return 'news';
            }

            // Messaging Apps
            const messaging = [
                'web.whatsapp.', 'telegram.', 'signal.',
                'slack.', 'teams.microsoft.'
            ];
            if (messaging.some(m => domain.includes(m))) {
                return 'messaging';
            }

            // Default to referral
            return 'referral';
        } catch {
            return 'direct';
        }
    }

    /**
     * Check if user agent indicates a bot/crawler
     */
    static isBot(userAgent: string): boolean {
        if (!userAgent) return false;

        const ua = userAgent.toLowerCase();

        const botPatterns = [
            // Major search engine bots
            'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
            'yandexbot', 'sogou', 'exabot', 'facebot', 'facebookexternalhit',

            // SEO/Monitoring tools
            'semrush', 'ahrefs', 'moz.com', 'dotbot', 'rogerbot',
            'screaming frog', 'sitebulb', 'deepcrawl',

            // AI/LLM crawlers
            'gptbot', 'chatgpt-user', 'claudebot', 'anthropic-ai',
            'ccbot', 'cohere-ai', 'bytespider', 'petalbot',
            'amazonbot', 'applebot',

            // Generic bot indicators
            'bot', 'spider', 'crawl', 'scrape', 'fetch',
            'headless', 'phantom', 'selenium', 'puppeteer', 'playwright',
            'wget', 'curl', 'python-requests', 'python-urllib',
            'java/', 'libwww', 'apache-httpclient',
            'go-http-client', 'ruby', 'perl',

            // Uptime monitors
            'pingdom', 'uptimerobot', 'statuscake', 'site24x7',
            'monitis', 'alertra', 'gtmetrix', 'webpagetest',

            // Preview/Link unfurlers
            'twitterbot', 'linkedinbot', 'slackbot', 'telegrambot',
            'discordbot', 'whatsapp', 'skypeuripreview',

            // Security scanners
            'nmap', 'nikto', 'sqlmap', 'masscan', 'zgrab'
        ];

        return botPatterns.some(pattern => ua.includes(pattern));
    }

    /**
     * Mask IP address for privacy - hide last octet for IPv4, last 80 bits for IPv6
     * Examples:
     * - IPv4: 192.168.1.123 -> 192.168.1.xxx
     * - IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334 -> 2001:0db8:85a3::xxxx
     */
    static maskIpAddress(ip: string): string {
        if (!ip) return '';

        // Handle IPv4
        if (ip.includes('.') && !ip.includes(':')) {
            const parts = ip.split('.');
            if (parts.length === 4) {
                parts[3] = 'xxx';
                return parts.join('.');
            }
        }

        // Handle IPv6 (or IPv4-mapped IPv6)
        if (ip.includes(':')) {
            const parts = ip.split(':');
            // Mask last 5 segments (80 bits) for IPv6
            if (parts.length >= 5) {
                const maskedParts = parts.slice(0, Math.max(3, parts.length - 5));
                maskedParts.push('xxxx');
                return maskedParts.join(':');
            }
        }

        // Fallback: mask last 5 characters
        if (ip.length > 5) {
            return ip.substring(0, ip.length - 5) + 'xxxxx';
        }

        return 'xxx.xxx.xxx.xxx';
    }


    /**
     * Get aggregated stats for dashboard
     */
    static async getStats(accountId: string, days: number = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const sessions = await prisma.analyticsSession.findMany({
            where: {
                accountId,
                createdAt: { gte: startDate }
            },
            select: {
                country: true,
                deviceType: true,
                browser: true,
                os: true,
                createdAt: true,
                lastActiveAt: true
            }
        });

        // Aggregate by country
        const countryMap = new Map<string, number>();
        const deviceMap = new Map<string, number>();
        const browserMap = new Map<string, number>();

        let totalDuration = 0;
        let sessionCount = 0;

        for (const s of sessions) {
            if (s.country) {
                countryMap.set(s.country, (countryMap.get(s.country) || 0) + 1);
            }
            if (s.deviceType) {
                deviceMap.set(s.deviceType, (deviceMap.get(s.deviceType) || 0) + 1);
            }
            if (s.browser) {
                browserMap.set(s.browser, (browserMap.get(s.browser) || 0) + 1);
            }

            // Calculate session duration
            if (s.createdAt && s.lastActiveAt) {
                const duration = new Date(s.lastActiveAt).getTime() - new Date(s.createdAt).getTime();
                if (duration > 0) {
                    totalDuration += duration;
                    sessionCount++;
                }
            }
        }

        return {
            countries: Array.from(countryMap.entries())
                .map(([country, sessions]) => ({ country, sessions }))
                .sort((a, b) => b.sessions - a.sessions)
                .slice(0, 10),
            devices: Array.from(deviceMap.entries())
                .map(([type, sessions]) => ({ type, sessions }))
                .sort((a, b) => b.sessions - a.sessions),
            browsers: Array.from(browserMap.entries())
                .map(([name, sessions]) => ({ name, sessions }))
                .sort((a, b) => b.sessions - a.sessions)
                .slice(0, 10),
            totalSessions: sessions.length,
            avgSessionDuration: sessionCount > 0 ? Math.round(totalDuration / sessionCount / 1000) : 0 // seconds
        };
    }

    /**
     * Get funnel data for dashboard
     */
    static async getFunnel(accountId: string, days: number = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const events = await prisma.analyticsEvent.findMany({
            where: {
                session: { accountId },
                createdAt: { gte: startDate }
            },
            select: {
                type: true,
                sessionId: true
            }
        });

        // Count unique sessions for each stage
        const productViews = new Set<string>();
        const addToCarts = new Set<string>();
        const checkouts = new Set<string>();
        const purchases = new Set<string>();

        for (const event of events) {
            if (event.type === 'product_view' || event.type === 'pageview') {
                productViews.add(event.sessionId);
            }
            if (event.type === 'add_to_cart') {
                addToCarts.add(event.sessionId);
            }
            if (event.type === 'checkout_start') {
                checkouts.add(event.sessionId);
            }
            if (event.type === 'purchase') {
                purchases.add(event.sessionId);
            }
        }

        return {
            stages: [
                { name: 'Product Views', count: productViews.size },
                { name: 'Add to Cart', count: addToCarts.size },
                { name: 'Checkout', count: checkouts.size },
                { name: 'Purchase', count: purchases.size }
            ]
        };
    }

    /**
     * Get revenue analytics: AOV, total, by source
     * Falls back to Elasticsearch order data if no analytics purchase events exist
     */
    static async getRevenue(accountId: string, days: number = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const purchaseEvents = await prisma.analyticsEvent.findMany({
            where: {
                session: { accountId },
                type: 'purchase',
                createdAt: { gte: startDate }
            },
            include: {
                session: {
                    select: {
                        firstTouchSource: true,
                        lastTouchSource: true,
                        country: true,
                        deviceType: true
                    }
                }
            }
        });

        let totalRevenue = 0;
        let orderCount = 0;
        const revenueByFirstTouch = new Map<string, number>();
        const revenueByLastTouch = new Map<string, number>();
        const revenueByCountry = new Map<string, number>();
        const revenueByDevice = new Map<string, number>();

        // If we have analytics purchase events, use them
        if (purchaseEvents.length > 0) {
            for (const event of purchaseEvents) {
                const total = (event.payload as any)?.total || 0;
                totalRevenue += total;

                // @ts-ignore - Prisma include type inference not working correctly with select
                const session = event.session as { firstTouchSource: string | null; lastTouchSource: string | null; country: string | null; deviceType: string | null };
                const firstTouch = session?.firstTouchSource || 'direct';
                const lastTouch = session?.lastTouchSource || 'direct';
                const country = session?.country || 'Unknown';
                const device = session?.deviceType || 'unknown';

                revenueByFirstTouch.set(firstTouch, (revenueByFirstTouch.get(firstTouch) || 0) + total);
                revenueByLastTouch.set(lastTouch, (revenueByLastTouch.get(lastTouch) || 0) + total);
                revenueByCountry.set(country, (revenueByCountry.get(country) || 0) + total);
                revenueByDevice.set(device, (revenueByDevice.get(device) || 0) + total);
            }
            orderCount = purchaseEvents.length;
        } else {
            // Fallback: Use WooCommerce orders from database when no analytics events exist
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    dateCreated: { gte: startDate },
                    status: { in: ['completed', 'processing', 'on-hold'] }
                },
                select: {
                    total: true,
                    rawData: true
                }
            });

            for (const order of orders) {
                const total = parseFloat(String(order.total)) || 0;
                totalRevenue += total;

                // Extract billing country from rawData JSON
                const rawDataObj = order.rawData as any;
                const country = rawDataObj?.billing?.country || 'Unknown';
                revenueByCountry.set(country, (revenueByCountry.get(country) || 0) + total);

                // For fallback orders without analytics, mark as 'direct'
                revenueByFirstTouch.set('direct', (revenueByFirstTouch.get('direct') || 0) + total);
                revenueByLastTouch.set('direct', (revenueByLastTouch.get('direct') || 0) + total);
                revenueByDevice.set('unknown', (revenueByDevice.get('unknown') || 0) + total);
            }
            orderCount = orders.length;
        }

        const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

        return {
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            orderCount,
            aov: Math.round(aov * 100) / 100,
            byFirstTouch: Array.from(revenueByFirstTouch.entries())
                .map(([source, revenue]) => ({ source, revenue: Math.round(revenue * 100) / 100 }))
                .sort((a, b) => b.revenue - a.revenue),
            byLastTouch: Array.from(revenueByLastTouch.entries())
                .map(([source, revenue]) => ({ source, revenue: Math.round(revenue * 100) / 100 }))
                .sort((a, b) => b.revenue - a.revenue),
            byCountry: Array.from(revenueByCountry.entries())
                .map(([country, revenue]) => ({ country, revenue: Math.round(revenue * 100) / 100 }))
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 10),
            byDevice: Array.from(revenueByDevice.entries())
                .map(([device, revenue]) => ({ device, revenue: Math.round(revenue * 100) / 100 }))
        };
    }

    /**
     * Get attribution data: first-touch vs last-touch comparison
     */
    static async getAttribution(accountId: string, days: number = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const sessions = await prisma.analyticsSession.findMany({
            where: {
                accountId,
                createdAt: { gte: startDate }
            },
            select: {
                firstTouchSource: true,
                lastTouchSource: true,
                cartValue: true
            }
        });

        const firstTouchCounts = new Map<string, number>();
        const lastTouchCounts = new Map<string, number>();

        for (const s of sessions) {
            const first = s.firstTouchSource || 'direct';
            const last = s.lastTouchSource || 'direct';
            firstTouchCounts.set(first, (firstTouchCounts.get(first) || 0) + 1);
            lastTouchCounts.set(last, (lastTouchCounts.get(last) || 0) + 1);
        }

        return {
            firstTouch: Array.from(firstTouchCounts.entries())
                .map(([source, count]) => ({ source, count }))
                .sort((a, b) => b.count - a.count),
            lastTouch: Array.from(lastTouchCounts.entries())
                .map(([source, count]) => ({ source, count }))
                .sort((a, b) => b.count - a.count),
            totalSessions: sessions.length
        };
    }

    /**
     * Get cart abandonment rate
     */
    static async getAbandonmentRate(accountId: string, days: number = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const events = await prisma.analyticsEvent.findMany({
            where: {
                session: { accountId },
                createdAt: { gte: startDate },
                type: { in: ['add_to_cart', 'purchase'] }
            },
            select: {
                type: true,
                sessionId: true
            }
        });

        const addedToCart = new Set<string>();
        const purchased = new Set<string>();

        for (const event of events) {
            if (event.type === 'add_to_cart') addedToCart.add(event.sessionId);
            if (event.type === 'purchase') purchased.add(event.sessionId);
        }

        const abandoned = [...addedToCart].filter(id => !purchased.has(id));
        const abandonmentRate = addedToCart.size > 0
            ? (abandoned.length / addedToCart.size) * 100
            : 0;

        return {
            addedToCartCount: addedToCart.size,
            purchasedCount: purchased.size,
            abandonedCount: abandoned.length,
            abandonmentRate: Math.round(abandonmentRate * 10) / 10
        };
    }

    /**
     * Get search analytics: top queries
     */
    static async getSearches(accountId: string, days: number = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const searchEvents = await prisma.analyticsEvent.findMany({
            where: {
                session: { accountId },
                type: 'search',
                createdAt: { gte: startDate }
            },
            select: {
                payload: true
            }
        });

        const queryCounts = new Map<string, number>();
        for (const event of searchEvents) {
            const query = ((event.payload as any)?.searchQuery || (event.payload as any)?.term || '').toLowerCase().trim();
            if (query) {
                queryCounts.set(query, (queryCounts.get(query) || 0) + 1);
            }
        }

        return {
            topQueries: Array.from(queryCounts.entries())
                .map(([query, count]) => ({ query, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 20),
            totalSearches: searchEvents.length
        };
    }

    /**
     * Get exit pages: where users leave
     */
    static async getExitPages(accountId: string, days: number = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const sessions = await prisma.analyticsSession.findMany({
            where: {
                accountId,
                createdAt: { gte: startDate }
            },
            select: {
                currentPath: true
            }
        });

        const exitCounts = new Map<string, number>();
        for (const s of sessions) {
            if (s.currentPath) {
                exitCounts.set(s.currentPath, (exitCounts.get(s.currentPath) || 0) + 1);
            }
        }

        return {
            topExitPages: Array.from(exitCounts.entries())
                .map(([page, count]) => ({ page, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 20)
        };
    }

    /**
     * Get cohort analysis: retention by signup week
     */
    static async getCohorts(accountId: string) {
        const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000);

        const sessions = await prisma.analyticsSession.findMany({
            where: {
                accountId,
                createdAt: { gte: eightWeeksAgo }
            },
            select: {
                visitorId: true,
                createdAt: true,
                lastActiveAt: true
            }
        });

        // Group by cohort week
        const cohorts = new Map<string, { visitors: Set<string>, retained: Map<number, Set<string>> }>();

        for (const s of sessions) {
            const cohortWeek = getWeekStart(s.createdAt);
            const cohortKey = cohortWeek.toISOString().split('T')[0];

            if (!cohorts.has(cohortKey)) {
                cohorts.set(cohortKey, { visitors: new Set(), retained: new Map() });
            }

            cohorts.get(cohortKey)!.visitors.add(s.visitorId);

            // Calculate which week they were last active
            const weeksSinceStart = Math.floor((s.lastActiveAt.getTime() - cohortWeek.getTime()) / (7 * 24 * 60 * 60 * 1000));
            for (let w = 0; w <= weeksSinceStart && w <= 7; w++) {
                if (!cohorts.get(cohortKey)!.retained.has(w)) {
                    cohorts.get(cohortKey)!.retained.set(w, new Set());
                }
                cohorts.get(cohortKey)!.retained.get(w)!.add(s.visitorId);
            }
        }

        return {
            cohorts: Array.from(cohorts.entries()).map(([week, data]) => ({
                week,
                totalVisitors: data.visitors.size,
                retention: Array.from(data.retained.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([weekNum, visitors]) => ({
                        week: weekNum,
                        count: visitors.size,
                        rate: Math.round((visitors.size / data.visitors.size) * 100)
                    }))
            })).sort((a, b) => a.week.localeCompare(b.week))
        };
    }

    /**
     * Calculate LTV for customers
     */
    static async getLTV(accountId: string) {
        const purchaseEvents = await prisma.analyticsEvent.findMany({
            where: {
                session: { accountId },
                type: 'purchase'
            },
            include: {
                session: {
                    select: { wooCustomerId: true, email: true }
                }
            }
        });

        const customerRevenue = new Map<string, number>();
        const customerOrders = new Map<string, number>();

        for (const event of purchaseEvents) {
            // @ts-ignore - Prisma include type inference not working correctly
            const session = event.session as { wooCustomerId: number | null; email: string | null };
            const customerId = (session.wooCustomerId?.toString()) || session.email || 'anonymous';
            const total = (event.payload as any)?.total || 0;

            customerRevenue.set(customerId, (customerRevenue.get(customerId) || 0) + total);
            customerOrders.set(customerId, (customerOrders.get(customerId) || 0) + 1);
        }

        const ltvValues = Array.from(customerRevenue.values());
        const avgLTV = ltvValues.length > 0
            ? ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length
            : 0;

        const repeatCustomers = [...customerOrders.values()].filter(c => c > 1).length;
        const repeatRate = customerOrders.size > 0
            ? (repeatCustomers / customerOrders.size) * 100
            : 0;

        return {
            avgLTV: Math.round(avgLTV * 100) / 100,
            totalCustomers: customerOrders.size,
            repeatCustomers,
            repeatRate: Math.round(repeatRate * 10) / 10,
            topCustomers: Array.from(customerRevenue.entries())
                .map(([id, ltv]) => ({ customerId: id, ltv: Math.round(ltv * 100) / 100, orders: customerOrders.get(id) || 0 }))
                .sort((a, b) => b.ltv - a.ltv)
                .slice(0, 10)
        };
    }

    /**
     * Calculate purchase intent score for a session
     */
    static calculatePurchaseIntent(session: any): number {
        let score = 0;

        // Pageviews (max 20 points)
        score += Math.min((session.totalVisits || 0) * 2, 20);

        // Has items in cart (30 points)
        if (session.cartValue && session.cartValue > 0) score += 30;

        // Cart value (max 20 points)
        score += Math.min((session.cartValue || 0) / 10, 20);

        // Is returning visitor (15 points)
        if (session.isReturning) score += 15;

        // Viewed checkout (15 points)
        if (session.currentPath?.includes('checkout')) score += 15;

        return Math.min(Math.round(score), 100);
    }
}

// Helper function for cohort analysis
function getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}
