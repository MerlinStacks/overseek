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
import { getPayloadWooOrderIdString } from '../../utils/orderIds';
import { hashSHA256, mapEventName, extractUserData, normalizePhoneE164 } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const TWITTER_API_BASE = 'https://ads-api.x.com/12/measurement/conversions';
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const KNOWN_EVENT_ID_PLACEHOLDERS = /^(?:ol288|23294827|event[-_ ]?id|your[-_ ]?event[-_ ]?id|placeholder)$/i;
const EVENT_ID_CONFIG_KEY: Record<string, string> = {
    purchase: 'eventIdPurchase',
    add_to_cart: 'eventIdAddToCart',
    checkout_start: 'eventIdInitiateCheckout',
    product_view: 'eventIdViewContent',
    search: 'eventIdSearch',
};

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

        const flatEventId = config[EVENT_ID_CONFIG_KEY[data.type]];
        const configuredEventId = typeof flatEventId === 'string'
            ? flatEventId.trim()
            : typeof config.eventIds?.[data.type] === 'string'
                ? config.eventIds[data.type].trim()
                : '';
        if (!configuredEventId || KNOWN_EVENT_ID_PLACEHOLDERS.test(configuredEventId)) {
            Logger.warn('[TwitterCAPI] Missing valid Events Manager event ID; skipping event', {
                accountId,
                eventType: data.type,
            });
            return;
        }

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData({
            ...data.payload,
            clickId: data.payload?.clickId || data.clickId,
            clickPlatform: data.payload?.clickPlatform || data.clickPlatform,
        }, session, data.ipAddress);
        const payload = this.buildPayload(configuredEventId, eventId, data, userData);

        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);
        await this.sendWithRetry(pixelId, accessToken, payload, deliveryId);
    }

    private buildPayload(
        configuredEventId: string,
        conversionId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
    ): Record<string, any> {
        const sourceTime = data.occurredAt
            || (data.type === 'purchase' ? data.payload?.dateCreated : undefined);
        const parsedTime = sourceTime ? new Date(sourceTime).getTime() : NaN;
        const conversion: Record<string, any> = {
            conversion_time: new Date(Number.isFinite(parsedTime) ? parsedTime : Date.now()).toISOString(),
            event_id: configuredEventId,
            conversion_id: conversionId,
            identifiers: [],
        };

        // Hashed identifiers for matching
        if (userData.email) {
            conversion.identifiers.push({
                hashed_email: hashSHA256(userData.email),
            });
        }
        const normalizedPhone = normalizePhoneE164(userData.phone, userData.country);
        if (normalizedPhone) {
            conversion.identifiers.push({
                hashed_phone_number: hashSHA256(normalizedPhone),
            });
        }

        // twclid for click attribution — check both cookie-forwarded and URL param paths
        const twclid = userData.twclid
            || (userData.clickId && userData.clickPlatform === 'twitter' ? userData.clickId : undefined);
        if (twclid) {
            conversion.identifiers.push({ twclid });
        }
        if (userData.ipAddress && userData.userAgent) {
            conversion.identifiers.push({
                ip_address: userData.ipAddress.trim(),
                user_agent: userData.userAgent.trim(),
            });
        }

        // Revenue
        if (data.payload) {
            if (data.payload.total !== undefined) conversion.value = String(data.payload.total);
            if (data.payload.currency) conversion.currency = data.payload.currency;
            const orderId = getPayloadWooOrderIdString(data.payload);
            if (orderId) conversion.order_id = orderId;
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
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });

                const responseBody = await response.text();

                if (response.ok) {
                    let processed = 0;
                    try {
                        processed = Number(JSON.parse(responseBody)?.data?.conversions_processed || 0);
                    } catch {
                        processed = 0;
                    }
                    if (processed < 1) {
                        const error = responseBody || 'X returned an invalid success response';
                        await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, error);
                        Logger.error('[TwitterCAPI] Conversion was not processed');
                        return;
                    }
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
