/**
 * Pinterest Conversions API Service
 *
 * Sends server-side conversion events to Pinterest CAPI.
 * POST https://api.pinterest.com/v5/ad_accounts/{adAccountId}/events
 *
 * Why server-side: Pinterest Tag (browser pixel) is blocked by ad blockers.
 * CAPI ensures conversion data reaches Pinterest for campaign optimisation.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { getPayloadWooOrderIdString } from '../../utils/orderIds';
import { hashSHA256, mapEventName, extractUserData, normalizePhoneE164 } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const PINTEREST_API_BASE = 'https://api.pinterest.com/v5';
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10_000;

export class PinterestCAPIService implements ConversionPlatformService {
    readonly platform = 'PINTEREST';

    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        const { adAccountId, accessToken } = config;
        if (!adAccountId || !accessToken) {
            Logger.warn('[PinterestCAPI] Missing adAccountId or accessToken', { accountId });
            return;
        }

        const eventName = mapEventName(data.type, 'PINTEREST');
        if (!eventName) return;

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData({
            ...data.payload,
            clickId: data.payload?.clickId || data.clickId,
            clickPlatform: data.payload?.clickPlatform || data.clickPlatform,
        }, session, data.ipAddress);
        const payload = this.buildPayload(eventName, eventId, data, userData);

        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);
        await this.sendWithRetry(adAccountId, accessToken, payload, deliveryId);
    }

    /**
     * Build Pinterest CAPI payload.
     * Spec: https://developers.pinterest.com/docs/api/v5/conversions-events-create/
     */
    private buildPayload(
        eventName: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
    ): Record<string, any> {
        const sourceTime = data.occurredAt
            || (data.type === 'purchase' ? data.payload?.dateCreated : undefined);
        const parsedTime = sourceTime ? new Date(sourceTime).getTime() : NaN;
        const normalizedPhone = normalizePhoneE164(userData.phone, userData.country)?.replace(/\D/g, '');
        const eventData: Record<string, any> = {
            event_name: eventName,
            action_source: 'web',
            event_time: Math.floor((Number.isFinite(parsedTime) ? parsedTime : Date.now()) / 1000),
            event_id: eventId,
            event_source_url: data.url,
            user_data: {
                em: userData.email ? [hashSHA256(userData.email)] : undefined,
                ph: normalizedPhone ? [hashSHA256(normalizedPhone)] : undefined,
                fn: userData.firstName ? [hashSHA256(userData.firstName)] : undefined,
                ln: userData.lastName ? [hashSHA256(userData.lastName)] : undefined,
                ct: userData.city ? [hashSHA256(userData.city)] : undefined,
                st: userData.state ? [hashSHA256(userData.state)] : undefined,
                zp: userData.zip ? [hashSHA256(userData.zip)] : undefined,
                country: userData.country ? [hashSHA256(userData.country)] : undefined,
                client_ip_address: userData.ipAddress,
                client_user_agent: userData.userAgent,
                // Pinterest click ID from epik URL attribution; fall back to cookie-forwarded value.
                click_id: userData.clickPlatform === 'pinterest' && userData.clickId ? userData.clickId : userData.epq || undefined,
                ...(userData.externalId ? { external_id: [hashSHA256(userData.externalId)] } : {}),
            },
        };

        // Remove undefined user_data fields
        eventData.user_data = Object.fromEntries(
            Object.entries(eventData.user_data).filter(([, v]) => v !== undefined),
        );

        // Add custom data for ecommerce events
        if (data.payload) {
            const customData: Record<string, any> = {};

            if (data.payload.total !== undefined) {
                customData.value = String(data.payload.total);
            }
            if (data.payload.currency) {
                customData.currency = data.payload.currency;
            }
            const orderId = getPayloadWooOrderIdString(data.payload);
            if (orderId) {
                customData.order_id = orderId;
            }
            if (Array.isArray(data.payload.items)) {
                const getProductId = (item: any): string => String(
                    item.productId || item.product_id || item.contentId || item.id || item.sku || '',
                );

                customData.contents = data.payload.items.map((item: any) => ({
                    id: getProductId(item),
                    item_name: item.name || '',
                    quantity: item.quantity || 1,
                    item_price: String(item.price || 0),
                }));
                customData.content_ids = data.payload.items.map(getProductId).filter(Boolean);
                customData.num_items = data.payload.items.length;
            }

            // Product category for better audience targeting
            if (Array.isArray(data.payload.categories) && data.payload.categories.length > 0) {
                customData.content_category = data.payload.categories.join(' > ');
            } else if (Array.isArray(data.payload.items) && data.payload.items[0]?.categories) {
                customData.content_category = data.payload.items[0].categories.join(' > ');
            }

            if (Object.keys(customData).length > 0) {
                eventData.custom_data = customData;
            }
        }

        return { data: [eventData] };
    }

    private async sendWithRetry(
        adAccountId: string,
        accessToken: string,
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        const url = `${PINTEREST_API_BASE}/ad_accounts/${adAccountId}/events`;

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
                Logger.error('[PinterestCAPI] Delivery failed', { status: response.status, adAccountId });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) {
                    await this.markDelivery(deliveryId, 'FAILED', null, null, attempt, error.message);
                    Logger.error('[PinterestCAPI] Network error after retries', { error: error.message });
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
                data: { accountId, platform: 'PINTEREST', eventName, eventId, payload: payload as object, status: 'PENDING' },
            });
            return d.id;
        } catch (error: any) {
            Logger.error('[PinterestCAPI] Failed to log delivery', { error: error.message });
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
            Logger.error('[PinterestCAPI] Failed to update delivery', { id, error: error.message });
        }
    }
}
