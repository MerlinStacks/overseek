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
import { getPayloadWooOrderIdString } from '../../utils/orderIds';
import { hashSHA256, mapEventName, extractUserData, normalizePhoneE164 } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const SNAPCHAT_API_BASE = 'https://tr.snapchat.com/v3';
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10_000;

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
        const userData = extractUserData({
            ...data.payload,
            clickId: data.payload?.clickId || data.clickId,
            clickPlatform: data.payload?.clickPlatform || data.clickPlatform,
        }, session, data.ipAddress);
        const payload = this.buildPayload(eventName, eventId, data, userData);

        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);
        await this.sendWithRetry(pixelId, accessToken, payload, deliveryId);
    }

    /**
     * Build Snapchat CAPI payload.
     * Spec: https://marketingapi.snapchat.com/docs/#conversions-api
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
        const user: Record<string, any> = {};
        const event: Record<string, any> = {
            event_name: eventName,
            event_time: Number.isFinite(parsedTime) ? parsedTime : Date.now(),
            event_id: eventId,
            action_source: 'WEB',
            event_source_url: data.url,
            user_data: user,
        };

        if (userData.email) user.em = [hashSHA256(userData.email)];
        const normalizedPhone = normalizePhoneE164(userData.phone, userData.country)?.replace(/\D/g, '');
        if (normalizedPhone) user.ph = [hashSHA256(normalizedPhone)];
        if (userData.firstName) user.fn = [hashSHA256(userData.firstName)];
        if (userData.lastName) user.ln = [hashSHA256(userData.lastName)];
        if (userData.city) user.ct = [hashSHA256(userData.city.replace(/[\s\p{P}]/gu, ''))];
        if (userData.state) user.st = [hashSHA256(userData.state.replace(/[\s\p{P}]/gu, ''))];
        if (userData.zip) user.zp = [hashSHA256(userData.zip.replace(/[\s-]/g, ''))];
        if (userData.country) user.country = [hashSHA256(userData.country)];
        if (userData.userAgent) user.client_user_agent = userData.userAgent;
        if (userData.ipAddress) user.client_ip_address = userData.ipAddress;

        const snapClickId = userData.clickPlatform === 'snapchat' ? userData.clickId : undefined;
        if (snapClickId) user.sc_click_id = snapClickId;
        if (userData.sclid) user.sc_cookie1 = userData.sclid;
        if (userData.externalId) user.external_id = hashSHA256(userData.externalId);

        // Ecommerce data
        if (data.payload) {
            const customData: Record<string, any> = {};
            if (data.payload.total !== undefined) customData.value = Number(data.payload.total);
            if (data.payload.currency) customData.currency = data.payload.currency;
            const orderId = getPayloadWooOrderIdString(data.payload);
            if (orderId) customData.order_id = orderId;
            if (Array.isArray(data.payload.items)) {
                customData.num_items = String(data.payload.items.length);
                customData.content_ids = data.payload.items
                    .map((item: any) => String(item.productId || item.contentId || item.id || item.sku || ''))
                    .filter(Boolean);
                customData.contents = data.payload.items.map((item: any) => ({
                    id: String(item.productId || item.contentId || item.id || item.sku || ''),
                    quantity: String(item.quantity || 1),
                    item_price: String(item.price || 0),
                }));
            }
            if (Object.keys(customData).length > 0) event.custom_data = customData;
        }

        return { data: [event] };
    }

    private async sendWithRetry(
        pixelId: string,
        accessToken: string,
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const url = `${SNAPCHAT_API_BASE}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });

                const responseBody = await response.text();

                if (response.ok) {
                    let status: string | undefined;
                    try {
                        status = JSON.parse(responseBody).status;
                    } catch {
                        status = undefined;
                    }
                    if (status !== 'VALID') {
                        const error = responseBody || 'Snapchat returned an invalid success response';
                        await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, error);
                        Logger.error('[SnapchatCAPI] Event was not accepted', { status });
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
