
import { prisma } from '../utils/prisma';
import geoip from 'geoip-lite';
import UAParser from 'ua-parser-js';

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

        if (data.ipAddress) sessionPayload.ipAddress = data.ipAddress;
        if (data.userAgent) sessionPayload.userAgent = data.userAgent;
        if (country) sessionPayload.country = country;
        if (city) sessionPayload.city = city;

        // Attribution (only set if not exists, or maybe overwrite if it's a new campaign?)
        // For simplicity, we'll strip falsy values to avoid overwriting with null if the client didn't send them this time
        if (data.referrer) sessionPayload.referrer = data.referrer;
        if (data.utmSource) sessionPayload.utmSource = data.utmSource;
        if (data.utmMedium) sessionPayload.utmMedium = data.utmMedium;
        if (data.utmCampaign) sessionPayload.utmCampaign = data.utmCampaign;

        // Parse User Agent with ua-parser-js for accurate detection
        if (data.userAgent) {
            const parser = new UAParser(data.userAgent);
            const result = parser.getResult();

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

        // If checkout success, clear cart or mark as converted
        if (data.type === 'checkout_success') {
            sessionPayload.cartValue = 0;
            sessionPayload.cartItems = [];
            sessionPayload.abandonedNotificationSentAt = null;
            // Potential improvement: Mark session as 'converted' if we had a field
        }

        // Handle Search (Just ensure payload has term)
        if (data.type === 'search') {
            // validating payload.term exists?
            // checking if we want to update session 'lastSearchTerm'?
        }

        // Session Stitching: Link visitor to customer on login
        if (data.type === 'identify' && data.payload?.customerId) {
            sessionPayload.customerId = String(data.payload.customerId);
            if (data.payload.email) {
                sessionPayload.email = data.payload.email;
            }
            if (data.payload.firstName) {
                sessionPayload.firstName = data.payload.firstName;
            }
            if (data.payload.lastName) {
                sessionPayload.lastName = data.payload.lastName;
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
     * Get Live Visitors (Active in last 30 mins)
     */
    static async getLiveVisitors(accountId: string) {
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

        return prisma.analyticsSession.findMany({
            where: {
                accountId,
                lastActiveAt: {
                    gte: thirtyMinsAgo
                }
            },
            orderBy: {
                lastActiveAt: 'desc'
            },
            take: 50 // Cap at 50 for live view
        });
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
}
