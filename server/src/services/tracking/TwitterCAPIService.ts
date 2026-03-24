/**
 * Twitter/X Conversions API Service
 *
 * Sends server-side conversion events to Twitter/X Ads.
 * Endpoint: POST https://ads-api.twitter.com/12/measurement/conversions/:pixel_id
 *
 * Why: Captures conversions that client-side X pixel misses due to ad blockers.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { hashSHA256, mapEventName, extractUserData } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const TWITTER_API_BASE = 'https://ads-api.twitter.com/12/measurement/conversions';
const MAX_RETRIES = 3;

export class TwitterCAPIService implements ConversionPlatformService {
    readonly platform = 'TWITTER';

    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        const { pixelId, accessToken } = config;
        if (!pixelId || !accessToken) {
            Logger.warn('[TwitterCAPI] Missing pixelId or accessToken', { accountId });
            return;
        }

        const eventName = mapEventName(data.type, 'TWITTER');
        if (!eventName) return;

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData(data.payload, session, data.ipAddress);
        const payload = this.buildPayload(eventName, eventId, data, userData);

        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);
        await this.sendWithRetry(pixelId, accessToken, payload, deliveryId);
    }

    private buildPayload(
        eventName: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
    ): Record<string, any> {
        const conversion: Record<string, any> = {
            conversion_time: new Date().toISOString(),
            event_id: eventId,
            identifiers: [],
        };

        // Hashed identifiers for matching
        if (userData.email) {
            conversion.identifiers.push({
                hashed_email: hashSHA256(userData.email),
            });
        }
        if (userData.phone) {
            conversion.identifiers.push({
                hashed_phone_number: hashSHA256(userData.phone),
            });
        }

        // twclid for click attribution — check both cookie-forwarded and URL param paths
        const twclid = userData.twclid
            || (userData.clickId && userData.clickPlatform === 'twitter' ? userData.clickId : undefined);
        if (twclid) {
            conversion.identifiers.push({ twclid });
        }

        // Revenue
        if (data.payload) {
            if (data.payload.total !== undefined) conversion.value = String(data.payload.total);
            if (data.payload.currency) conversion.currency = data.payload.currency;
            if (data.payload.orderId) conversion.order_id = String(data.payload.orderId);
            if (Array.isArray(data.payload.items)) {
                conversion.number_items = data.payload.items.length;
            }
        }

        return {
            conversions: [conversion],
        };
    }

    private async sendWithRetry(
        pixelId: string,
        accessToken: string,
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        const url = `${TWITTER_API_BASE}/${pixelId}`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, {
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
                Logger.error('[TwitterCAPI] Delivery failed', { status: response.status });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) {
                    await this.markDelivery(deliveryId, 'FAILED', null, null, attempt, error.message);
                    Logger.error('[TwitterCAPI] Network error after retries', { error: error.message });
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
                data: { accountId, platform: 'TWITTER', eventName, eventId, payload: payload as object, status: 'PENDING' },
            });
            return d.id;
        } catch (error: any) {
            Logger.error('[TwitterCAPI] Failed to log delivery', { error: error.message });
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
            Logger.error('[TwitterCAPI] Failed to update delivery', { id, error: error.message });
        }
    }
}
