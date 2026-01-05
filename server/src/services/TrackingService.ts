
import { prisma } from '../utils/prisma';
import geoip from 'geoip-lite';

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

        if (data.ipAddress) {
            const geo = geoip.lookup(data.ipAddress);
            if (geo) {
                country = geo.country;
                city = geo.city;
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

        // Parse User Agent for Device/OS/Browser if we want to be fancy.
        // For now, we rely on the client sending explicit fields or just storing the UA string.
        // The schema has deviceType, browser, os.
        // Let's do some basic UA parsing if we have the string.
        if (data.userAgent) {
            const ua = data.userAgent.toLowerCase();
            if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
                sessionPayload.deviceType = 'mobile';
            } else if (ua.includes('tablet') || ua.includes('ipad')) {
                sessionPayload.deviceType = 'tablet';
            } else {
                sessionPayload.deviceType = 'desktop';
            }

            if (ua.includes('chrome')) sessionPayload.browser = 'Chrome';
            else if (ua.includes('firefox')) sessionPayload.browser = 'Firefox';
            else if (ua.includes('safari')) sessionPayload.browser = 'Safari';
            else if (ua.includes('edge')) sessionPayload.browser = 'Edge';

            if (ua.includes('windows')) sessionPayload.os = 'Windows';
            else if (ua.includes('mac os')) sessionPayload.os = 'macOS';
            else if (ua.includes('linux')) sessionPayload.os = 'Linux';
            else if (ua.includes('android')) sessionPayload.os = 'Android';
            else if (ua.includes('ios') || ua.includes('iphone')) sessionPayload.os = 'iOS';
        }

        // Handle Cart updates
        if (data.type === 'add_to_cart' || data.type === 'remove_from_cart' || data.type === 'update_cart') {
            // Expect payload to have cartTotal and items
            if (data.payload && typeof data.payload.total !== 'undefined') {
                sessionPayload.cartValue = data.payload.total;
                sessionPayload.cartItems = data.payload.items || [];
                sessionPayload.currency = data.payload.currency || 'USD';
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
}
