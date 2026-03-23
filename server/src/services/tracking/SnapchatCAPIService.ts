/**
 * Snapchat Conversions API Service
 *
 * Sends server-side conversion events to Snapchat via their CAPI.
 * POST https://tr.snapchat.com/v3/conversion
 *
 * Why server-side: Snap Pixel is blocked by ad blockers ~25% of the time.
 * CAPI ensures Snapchat receives conversion data for campaign optimisation.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { hashSHA256, mapEventName, extractUserData } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const SNAPCHAT_API_URL = 'https://tr.snapchat.com/v3/conversion';
const MAX_RETRIES = 3;

export class SnapchatCAPIService implements ConversionPlatformService {
    readonly platform = 'SNAPCHAT';

    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        const { pixelId, accessToken } = config;
        if (!pixelId || !accessToken) {
            Logger.warn('[SnapchatCAPI] Missing pixelId or accessToken', { accountId });
            return;
        }

        const eventName = mapEventName(data.type, 'SNAPCHAT');
        if (!eventName) return;

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData(data.payload, session);
        const payload = this.buildPayload(pixelId, eventName, eventId, data, userData);

        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);
        await this.sendWithRetry(accessToken, payload, deliveryId);
    }

    /**
     * Build Snapchat CAPI payload.
     * Spec: https://marketingapi.snapchat.com/docs/#conversions-api
     */
    private buildPayload(
        pixelId: string,
        eventName: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
    ): Record<string, any> {
        const event: Record<string, any> = {
            pixel_id: pixelId,
            event_type: eventName,
            event_conversion_type: 'WEB',
            timestamp: Math.floor(Date.now() / 1000).toString(),
            event_tag: eventId, // Snap uses event_tag for deduplication
            page_url: data.url,
        };

        // Hashed user data for matching
        if (userData.email) event.hashed_email = hashSHA256(userData.email);
        if (userData.phone) event.hashed_phone_number = hashSHA256(userData.phone);
        if (userData.ipAddress) event.hashed_ip_address = hashSHA256(userData.ipAddress);
        if (userData.firstName) event.hashed_first_name_sha = hashSHA256(userData.firstName);
        if (userData.lastName) event.hashed_last_name_sha = hashSHA256(userData.lastName);
        if (userData.city) event.hashed_city_sha = hashSHA256(userData.city);
        if (userData.state) event.hashed_state_sha = hashSHA256(userData.state);
        if (userData.zip) event.hashed_zip = hashSHA256(userData.zip);

        // User agent and IP for matching
        if (userData.userAgent) event.user_agent = userData.userAgent;
        if (userData.ipAddress) event.client_ip_address = userData.ipAddress;

        // Snap click ID cookie
        if (userData.sclid) event.click_id = userData.sclid;

        // Ecommerce data
        if (data.payload) {
            if (data.payload.total !== undefined) event.price = String(data.payload.total);
            if (data.payload.currency) event.currency = data.payload.currency;
            if (data.payload.orderId) event.transaction_id = String(data.payload.orderId);
            if (Array.isArray(data.payload.items)) {
                event.number_items = String(data.payload.items.length);
                event.item_ids = JSON.stringify(data.payload.items.map((i: any) => String(i.id || i.sku || '')));
            }
        }

        return { data: [event] };
    }

    private async sendWithRetry(
        accessToken: string,
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(SNAPCHAT_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify(payload),
                });

                const responseBody = await response.text();

                if (response.ok) {
                    await this.markDelivery(deliveryId, 'SENT', response.status, responseBody, attempt);
                    return;
                }

                if (response.status === 429 || response.status >= 500) {
                    if (attempt < MAX_RETRIES) {
                        await this.backoff(attempt);
                        continue;
                    }
                }

                await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, responseBody);
                Logger.error('[SnapchatCAPI] Delivery failed', { status: response.status });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) {
                    await this.markDelivery(deliveryId, 'FAILED', null, null, attempt, error.message);
                    Logger.error('[SnapchatCAPI] Network error after retries', { error: error.message });
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
                data: { accountId, platform: 'SNAPCHAT', eventName, eventId, payload: payload as object, status: 'PENDING' },
            });
            return d.id;
        } catch (error: any) {
            Logger.error('[SnapchatCAPI] Failed to log delivery', { error: error.message });
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
            Logger.error('[SnapchatCAPI] Failed to update delivery', { id, error: error.message });
        }
    }
}
