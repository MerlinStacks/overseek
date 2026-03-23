/**
 * TikTok Events API Service
 *
 * Sends server-side conversion events to TikTok Events API.
 * POST https://business-api.tiktok.com/open_api/v1.3/event/track/
 *
 * Why server-side: TikTok Pixel is heavily blocked by ad blockers.
 * Server events ensure attribution data reaches TikTok for campaign
 * optimisation regardless of client-side blocking.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { hashSHA256, mapEventName, extractUserData } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v2/event/track/';
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
        const userData = extractUserData(data.payload, session);
        const payload = this.buildPayload(pixelCode, eventName, eventId, data, userData, testEventCode);

        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);
        await this.sendWithRetry(accessToken, payload, deliveryId);
    }

    /**
     * Build TikTok Events API payload.
     * Spec: https://business-api.tiktok.com/portal/docs?id=1741601162187777
     */
    private buildPayload(
        pixelCode: string,
        eventName: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
        testEventCode?: string,
    ): Record<string, any> {
        const eventData: Record<string, any> = {
            event: eventName,
            event_id: eventId,
            event_time: Math.floor(Date.now() / 1000),
            user: {
                // TikTok requires SHA-256 hashed PII
                email: hashSHA256(userData.email),
                phone: hashSHA256(userData.phone),
                ip: userData.ipAddress,
                user_agent: userData.userAgent,
                // TikTok click ID
                ttclid: userData.ttp,
            },
            page: {
                url: data.url,
                referrer: data.referrer || undefined,
            },
        };

        // Remove undefined user fields
        eventData.user = Object.fromEntries(
            Object.entries(eventData.user).filter(([, v]) => v !== undefined),
        );

        // Add properties for ecommerce events
        if (data.payload) {
            const properties: Record<string, any> = {};

            if (data.payload.total !== undefined) {
                properties.value = data.payload.total;
            }
            if (data.payload.currency) {
                properties.currency = data.payload.currency;
            }
            if (data.payload.orderId) {
                properties.order_id = String(data.payload.orderId);
            }
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

            if (Object.keys(properties).length > 0) {
                eventData.properties = properties;
            }
        }

        const body: Record<string, any> = {
            pixel_code: pixelCode,
            event: eventName,
            event_id: eventId,
            timestamp: new Date().toISOString(),
            context: eventData.user,
            properties: eventData.properties || {},
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

                    // TikTok-level error
                    await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, parsed.message || 'TikTok API error');
                    Logger.error('[TikTokEvents] API error', {
                        code: parsed.code,
                        message: parsed.message,
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
                Logger.error('[TikTokEvents] HTTP error', { status: response.status });
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

    private backoff(attempt: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }

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
