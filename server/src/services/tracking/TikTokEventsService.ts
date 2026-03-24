/**
 * TikTok Events API Service
 *
 * Sends server-side conversion events to TikTok Events API v1.3.
 * POST https://business-api.tiktok.com/open_api/v1.3/event/track/
 *
 * Why server-side: TikTok Pixel is heavily blocked by ad blockers.
 * Server events ensure attribution data reaches TikTok for campaign
 * optimisation regardless of client-side blocking.
 *
 * Payload spec: https://business-api.tiktok.com/portal/docs?id=1741601162187777
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { hashSHA256, mapEventName, extractUserData } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

/** TikTok Events API v1.3 — the current stable version */
const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
const MAX_RETRIES = 3;

export class TikTokEventsService implements ConversionPlatformService {
    readonly platform = 'TIKTOK';

    /**
     * Send a conversion event to TikTok Events API.
     */
    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        const { pixelCode, accessToken, testEventCode } = config;
        if (!pixelCode || !accessToken) {
            Logger.warn('[TikTokEvents] Missing pixelCode or accessToken', { accountId });
            return;
        }

        const eventName = mapEventName(data.type, 'TIKTOK');
        if (!eventName) return;

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData(data.payload, session, data.ipAddress);
        const payload = this.buildPayload(pixelCode, eventName, eventId, data, userData, testEventCode);

        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);
        await this.sendWithRetry(accessToken, payload, deliveryId);
    }

    /**
     * Build TikTok Events API v1.3 payload.
     *
     * Required structure:
     * {
     *   event_source: "web",
     *   event_source_id: "<pixel_code>",
     *   data: [{ event, event_time, event_id, user: {...}, properties: {...}, page: {...} }]
     * }
     */
    private buildPayload(
        pixelCode: string,
        eventName: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
        testEventCode?: string,
    ): Record<string, any> {
        // Build user object — TikTok requires SHA-256 hashed PII
        const user: Record<string, any> = {};
        const hashedEmail = hashSHA256(userData.email);
        if (hashedEmail) user.email = hashedEmail;
        const hashedPhone = hashSHA256(userData.phone);
        if (hashedPhone) user.phone_number = hashedPhone;
        if (userData.ipAddress) user.ip = userData.ipAddress;
        if (userData.userAgent) user.user_agent = userData.userAgent;
        if (userData.ttp) user.ttclid = userData.ttp;

        // Build page context
        const page: Record<string, any> = {};
        if (data.url) page.url = data.url;
        if (data.referrer) page.referrer = data.referrer;

        // Build properties for ecommerce events
        const properties: Record<string, any> = {};
        if (data.payload) {
            if (data.payload.total !== undefined) properties.value = data.payload.total;
            if (data.payload.currency) properties.currency = data.payload.currency;
            if (data.payload.orderId) properties.order_id = String(data.payload.orderId);
            if (Array.isArray(data.payload.items)) {
                properties.contents = data.payload.items.map((item: any) => ({
                    content_id: String(item.id || item.sku || ''),
                    content_type: 'product',
                    content_name: item.name || '',
                    quantity: item.quantity || 1,
                    price: item.price || 0,
                }));
                properties.content_type = 'product';
            }
        }

        // Build the single event entry inside the data array
        const eventEntry: Record<string, any> = {
            event: eventName,
            event_time: Math.floor(Date.now() / 1000),
            event_id: eventId,
            user,
            properties,
            page,
        };

        // Build top-level payload per v1.3 spec
        const body: Record<string, any> = {
            event_source: 'web',
            event_source_id: pixelCode,
            data: [eventEntry],
        };

        if (testEventCode) {
            body.test_event_code = testEventCode;
        }

        return body;
    }

    /**
     * Send with exponential backoff retry.
     */
    private async sendWithRetry(
        accessToken: string,
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(TIKTOK_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Token': accessToken,
                    },
                    body: JSON.stringify(payload),
                });

                const responseBody = await response.text();

                if (response.ok) {
                    // TikTok returns 200 even for some errors — check response body
                    let parsed: any;
                    try {
                        parsed = JSON.parse(responseBody);
                    } catch {
                        parsed = {};
                    }

                    if (parsed.code === 0) {
                        await this.markDelivery(deliveryId, 'SENT', response.status, responseBody, attempt);
                        return;
                    }

                    // TikTok-level error (200 status but non-zero code)
                    await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, parsed.message || 'TikTok API error');
                    Logger.error('[TikTokEvents] API error', {
                        code: parsed.code,
                        message: parsed.message,
                        response: responseBody.substring(0, 500),
                    });
                    return;
                }

                if (response.status === 429 || response.status >= 500) {
                    if (attempt < MAX_RETRIES) {
                        await this.backoff(attempt);
                        continue;
                    }
                }

                await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, responseBody);
                Logger.error('[TikTokEvents] HTTP error', {
                    status: response.status,
                    response: responseBody.substring(0, 500),
                });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) {
                    await this.markDelivery(deliveryId, 'FAILED', null, null, attempt, error.message);
                    Logger.error('[TikTokEvents] Network error after retries', { error: error.message });
                    return;
                }
                await this.backoff(attempt);
            }
        }
    }

    /** Exponential backoff: 2^attempt * 1000ms */
    private backoff(attempt: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }

    /** Create a PENDING delivery log entry */
    private async logDelivery(
        accountId: string,
        eventName: string,
        eventId: string,
        payload: Record<string, any>,
    ): Promise<string> {
        try {
            const delivery = await prisma.conversionDelivery.create({
                data: { accountId, platform: 'TIKTOK', eventName, eventId, payload: payload as object, status: 'PENDING' },
            });
            return delivery.id;
        } catch (error: any) {
            Logger.error('[TikTokEvents] Failed to log delivery', { error: error.message });
            return 'unknown';
        }
    }

    /** Update delivery status after send attempt */
    private async markDelivery(
        deliveryId: string,
        status: string,
        httpStatus: number | null,
        response: string | null,
        attempts: number,
        lastError?: string,
    ): Promise<void> {
        if (deliveryId === 'unknown') return;
        try {
            await prisma.conversionDelivery.update({
                where: { id: deliveryId },
                data: {
                    status,
                    httpStatus,
                    response: response?.substring(0, 2000),
                    attempts,
                    lastError: lastError?.substring(0, 2000),
                    sentAt: status === 'SENT' ? new Date() : undefined,
                },
            });
        } catch (error: any) {
            Logger.error('[TikTokEvents] Failed to update delivery', { deliveryId, error: error.message });
        }
    }
}
