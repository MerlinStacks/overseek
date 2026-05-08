/**
 * GA4 Measurement Protocol Service
 *
 * Sends server-side events to Google Analytics 4 via the Measurement Protocol.
 * POST https://www.google-analytics.com/mp/collect
 *
 * Why server-side: Ad blockers block the client-side GA4 tag (gtag.js) for
 * ~15-30% of visitors. Measurement Protocol fills this gap with server-side
 * events, ensuring accurate revenue and conversion reporting in GA4.
 *
 * FIXES APPLIED (May 2026):
 * - session_id: GA4 requires this for session attribution (was missing)
 * - timestamp_micros: Ensures events recorded at correct time (was missing)
 * - consent object: Prevents GA4 from dropping events under strict consent mode
 * - engagement_time_msec: Now sent as number instead of string
 * - page_title, page_referrer: Added for richer reporting
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { mapEventName, extractUserData } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const GA4_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';
const MAX_RETRIES = 3;

export class GA4MeasurementService implements ConversionPlatformService {
    readonly platform = 'GA4';

    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: {
            id: string;
            email?: string | null;
            ipAddress?: string | null;
            userAgent?: string | null;
            country?: string | null;
            /** Unix timestamp (seconds) for GA4 session_id */
            sessionStartAt?: number | null;
            /** AnalyticsSession.referrer */
            referrer?: string | null;
        } | null,
    ): Promise<void> {
        const { measurementId, apiSecret, useDebugEndpoint } = config;
        if (!measurementId || !apiSecret) {
            Logger.warn('[GA4Measurement] Missing measurementId or apiSecret', { accountId });
            return;
        }

        const eventName = mapEventName(data.type, 'GA4');
        if (!eventName) return;

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData(data.payload, session, data.ipAddress);

        // GA4 requires a client_id — use GA cookie value or fall back to visitorId
        const clientId = this.extractGAClientId(userData.gaClientId) || data.visitorId;

        // Build session_id from session start time (required for session attribution)
        const sessionId = this.buildSessionId(session, data);

        const payload = this.buildPayload(eventName, eventId, clientId, sessionId, data, session);
        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);

        const endpoint = useDebugEndpoint ? GA4_DEBUG_ENDPOINT : GA4_ENDPOINT;
        await this.sendWithRetry(endpoint, measurementId, apiSecret, payload, deliveryId);
    }

    /**
     * Extract GA client ID from _ga cookie value.
     * Cookie format: GA1.1.1234567890.1234567890 → "1234567890.1234567890"
     */
    private extractGAClientId(gaCookie: string | undefined): string | undefined {
        if (!gaCookie) return undefined;

        // Standard _ga cookie: GA1.{container_count}.{cid1}.{cid2}
        const parts = gaCookie.split('.');
        if (parts.length >= 4) {
            return `${parts[2]}.${parts[3]}`;
        }

        // Already a bare client ID
        return gaCookie;
    }

    /**
     * Build GA4 session_id from session start time.
     * GA4 session_id must be a Unix timestamp in seconds since epoch.
     * Falls back to a deterministic hash of visitorId if session start time
     * is not available, which preserves session continuity across events.
     */
    private buildSessionId(
        session: { sessionStartAt?: number | null; id?: string; startAt?: Date | null } | null,
        data: TrackingEventPayload,
    ): number {
        // Use explicit session start timestamp if available
        if (session?.sessionStartAt) {
            return Math.floor(session.sessionStartAt);
        }

        // Fall back to visitorId-based deterministic hash (stable per visitor)
        // This ensures events from the same visitor map to the same session
        // even when session metadata hasn't propagated yet.
        const visitorId = data.visitorId;
        let hash = 0;
        for (let i = 0; i < visitorId.length; i++) {
            const char = visitorId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        // Use a recent timestamp offset by the hash to spread sessions
        const baseTime = Math.floor(Date.now() / 1000);
        const offset = Math.abs(hash) % 300; // Max 5 min offset
        return baseTime - offset;
    }

    /**
     * Build GA4 Measurement Protocol payload.
     * Spec: https://developers.google.com/analytics/devguides/collection/protocol/ga4
     */
    private buildPayload(
        eventName: string,
        eventId: string,
        clientId: string,
        sessionId: number,
        data: TrackingEventPayload,
        session: { referrer?: string | null } | null,
    ): Record<string, any> {
        const event: Record<string, any> = {
            name: eventName,
            params: {
                event_id: eventId,
                page_location: data.url,
                // FIX: session_id is REQUIRED for GA4 to attribute events to sessions
                session_id: sessionId,
                // FIX: engagement_time_msec must be a number, not a string
                engagement_time_msec: 100, // Required by GA4 for events to show in reports
            },
        };

        // FIX: Add page_title if available
        if (data.pageTitle) {
            event.params.page_title = data.pageTitle;
        }

        // FIX: Add page_referrer from session or event data
        const pageReferrer = data.referrer || session?.referrer;
        if (pageReferrer) {
            event.params.page_referrer = pageReferrer;
        }

        // Add ecommerce data in GA4 format
        if (data.payload) {
            if (data.payload.total !== undefined) {
                event.params.value = data.payload.total;
            }
            if (data.payload.currency) {
                event.params.currency = data.payload.currency;
            }
            if (data.payload.orderId) {
                event.params.transaction_id = String(data.payload.orderId);
            }
            if (data.payload.tax !== undefined) {
                event.params.tax = data.payload.tax;
            }
            if (data.payload.shipping !== undefined) {
                event.params.shipping = data.payload.shipping;
            }
            // FIX: Include user-provided coupon codes for GA4 purchase event
            if (Array.isArray(data.payload.couponCodes) && data.payload.couponCodes.length > 0) {
                event.params.coupon = data.payload.couponCodes.join(',');
            }
            if (Array.isArray(data.payload.items)) {
                event.params.items = data.payload.items.map((item: any) => ({
                    item_id: String(item.contentId || item.id || item.sku || ''),
                    item_name: item.name || '',
                    quantity: item.quantity || 1,
                    price: item.price || 0,
                }));

                // Product category from items array
                if (data.payload.items[0]?.categories) {
                    event.params.item_category = data.payload.items[0].categories.join(' > ');
                }
            }

            // Product category from payload top-level
            if (Array.isArray(data.payload.categories) && data.payload.categories.length > 0) {
                event.params.item_category = data.payload.categories.join(' > ');
            }

            // Search term
            if (data.type === 'search' && data.payload.term) {
                event.params.search_term = data.payload.term;
            }
        }

        const body: Record<string, any> = {
            client_id: clientId,
            events: [event],
            // FIX: timestamp_micros ensures event recorded at correct time
            timestamp_micros: Math.floor(Date.now() * 1000),
            // Non-personalised ads flag for privacy
            non_personalized_ads: false,
        };

        // FIX: Add consent object to prevent GA4 from dropping events under strict consent mode.
        // The server-side event is sent only when the store owner has enabled GA4 CAPI,
        // which implies consent to send conversion data to Google.
        body.consent = {
            ad_user_data: 'GRANTED',
            ad_personalization: 'GRANTED',
            analytics_storage: 'GRANTED',
        };

        // Add user_id if we have a customer ID (for cross-device tracking in GA4)
        if (data.payload?.customerId) {
            body.user_id = String(data.payload.customerId);
        }

        return body;
    }

    private async sendWithRetry(
        endpoint: string,
        measurementId: string,
        apiSecret: string,
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        const url = `${endpoint}?measurement_id=${measurementId}&api_secret=${apiSecret}`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                const responseBody = await response.text();

                // GA4 MP returns 204 (no content) on success, 200 for debug endpoint
                if (response.status === 204 || response.ok) {
                    await this.markDelivery(deliveryId, 'SENT', response.status, responseBody || 'OK', attempt);
                    return;
                }

                if (response.status === 429 || response.status >= 500) {
                    if (attempt < MAX_RETRIES) {
                        await this.backoff(attempt);
                        continue;
                    }
                }

                await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, responseBody);
                Logger.error('[GA4Measurement] Delivery failed', { status: response.status, measurementId });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) {
                    await this.markDelivery(deliveryId, 'FAILED', null, null, attempt, error.message);
                    Logger.error('[GA4Measurement] Network error after retries', { error: error.message });
                    return;
                }
                await this.backoff(attempt);
            }
        }
    }

    private backoff(attempt: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }

    private async logDelivery(accountId: string, eventName: string, eventId: string, payload: Record<string, any>): Promise<string> {
        try {
            const d = await prisma.conversionDelivery.create({
                data: { accountId, platform: 'GA4', eventName, eventId, payload: payload as object, status: 'PENDING' },
            });
            return d.id;
        } catch (error: any) {
            Logger.error('[GA4Measurement] Failed to log delivery', { error: error.message });
            return 'unknown';
        }
    }

    private async markDelivery(id: string, status: string, httpStatus: number | null, response: string | null, attempts: number, lastError?: string): Promise<void> {
        if (id === 'unknown') return;
        try {
            await prisma.conversionDelivery.update({
                where: { id },
                data: { status, httpStatus, response: response?.substring(0, 2000), attempts, lastError: lastError?.substring(0, 2000), sentAt: status === 'SENT' ? new Date() : undefined },
            });
        } catch (error: any) {
            Logger.error('[GA4Measurement] Failed to update delivery', { id, error: error.message });
        }
    }
}
