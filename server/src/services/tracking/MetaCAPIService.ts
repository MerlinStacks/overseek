/**
 * Meta CAPI Service
 *
 * Sends server-side conversion events to Meta (Facebook/Instagram)
 * Conversions API: POST https://graph.facebook.com/v25.0/{pixelId}/events
 *
 * Why server-side: Browser-side Meta Pixel is blocked by ~30% of users
 * via ad blockers. CAPI sends the same events server-to-server for
 * complete attribution data.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { getPayloadWooOrderIdString } from '../../utils/orderIds';
import { hashSHA256, mapEventName, extractUserData, normalizePhoneE164, resolveConversionEventDate } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const API_VERSION = 'v25.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Max retry attempts for transient failures */
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Normalise an IP address by stripping IPv6-mapped prefix.
 * Docker/Node often reports IPs as `::ffff:10.0.0.1` which looks
 * like a valid IPv6 address but is actually a mapped IPv4.
 */
function normaliseIp(ip: string): string {
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
}

/**
 * Check if an IP address is a public routable address.
 * Meta CAPI rejects private, loopback, and link-local IPs.
 */
function isPublicIp(ip: string | undefined): boolean {
    if (!ip || ip.trim() === '') return false;
    const normalised = normaliseIp(ip.trim());
    // IPv4 private ranges + loopback
    if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.|169\.254\.)/.test(normalised)) return false;
    // IPv6 loopback and link-local
    if (normalised === '::1' || normalised.startsWith('fe80:') || normalised.startsWith('fc') || normalised.startsWith('fd')) return false;
    return true;
}

export class MetaCAPIService implements ConversionPlatformService {
    readonly platform = 'META';

    private hasSufficientMatchData(userData: Record<string, any>): boolean {
        return Boolean(
            userData.em ||
            userData.ph ||
            userData.fbc ||
            userData.fbp ||
            (userData.client_ip_address && userData.client_user_agent)
        );
    }

    /**
     * Send a conversion event to Meta CAPI.
     * Handles PII hashing, payload formatting, delivery logging, and retries.
     */
    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        const { pixelId, accessToken, testEventCode } = config;
        if (!pixelId || !accessToken) {
            Logger.warn('[MetaCAPI] Missing pixelId or accessToken', { accountId });
            return;
        }

        const eventName = mapEventName(data.type, 'META');
        if (!eventName) return;

        const eventId = data.eventId || crypto.randomUUID();
        const topLevelData = data as TrackingEventPayload & Record<string, any>;
        const userData = extractUserData({
            ...(data.payload || {}),
            email: data.email ?? data.payload?.email,
            customerId: data.customerId ?? data.payload?.customerId,
            clickId: data.clickId ?? data.payload?.clickId,
            clickPlatform: String(data.clickPlatform ?? data.payload?.clickPlatform ?? '').trim().toLowerCase() || undefined,
            fbc: topLevelData.fbc ?? data.payload?.fbc,
            fbp: topLevelData.fbp ?? data.payload?.fbp,
        }, session, data.ipAddress);
        const occurrenceDate = resolveConversionEventDate(topLevelData.occurredAt, data.payload);
        if (!userData.fbc && (userData.clickPlatform === 'facebook' || userData.clickPlatform === 'meta') && userData.clickId) {
            userData.fbc = `fb.1.${occurrenceDate.getTime()}.${userData.clickId}`;
        }
        const payload = this.buildPayload(eventName, eventId, data, userData, config, occurrenceDate, testEventCode);
        const payloadUserData = payload.data?.[0]?.user_data || {};

        if (!this.hasSufficientMatchData(payloadUserData)) {
            Logger.warn('[MetaCAPI] Skipping event with insufficient customer match data', {
                pixelId,
                eventName,
                eventId,
                hasEmail: Boolean(payloadUserData.em),
                hasPhone: Boolean(payloadUserData.ph),
                hasFbc: Boolean(payloadUserData.fbc),
                hasFbp: Boolean(payloadUserData.fbp),
                hasIp: Boolean(payloadUserData.client_ip_address),
                hasUserAgent: Boolean(payloadUserData.client_user_agent),
            });
            return;
        }


        // Log delivery as PENDING before sending
        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);

        await this.sendWithRetry(pixelId, accessToken, payload, deliveryId);
    }

    /**
     * Build Meta CAPI event payload.
     * Spec: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
     */
    private buildPayload(
        eventName: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
        config: Record<string, any>,
        occurrenceDate: Date,
        testEventCode?: string,
    ): Record<string, any> {
        const contentIdFormat = config.contentIdFormat || 'sku';
        const contentIdPrefix = config.contentIdPrefix || '';
        const contentIdSuffix = config.contentIdSuffix || '';

        const getContentId = (item: any): string => {
            if (item.contentId !== undefined && item.contentId !== null && String(item.contentId).trim() !== '') {
                return String(item.contentId);
            }
            const raw = contentIdFormat === 'id' ? String(item.id || '') : String(item.sku || item.id || '');
            return `${contentIdPrefix}${raw}${contentIdSuffix}` || raw;
        };
        const advancedMatching = config.advancedMatching === true;
        const metaPhone = normalizePhoneE164(userData.phone, userData.country)?.replace(/\D/g, '');
        const eventData: Record<string, any> = {
            event_name: eventName,
            event_time: Math.floor(occurrenceDate.getTime() / 1000),
            event_id: eventId,
            action_source: 'website',
            event_source_url: data.url,
            user_data: {
                // Hash all PII fields — Meta requires SHA-256
                ...(advancedMatching ? {
                    em: hashSHA256(userData.email),
                    ph: hashSHA256(metaPhone),
                    fn: hashSHA256(userData.firstName),
                    ln: hashSHA256(userData.lastName),
                    ct: hashSHA256(userData.city),
                    st: hashSHA256(userData.state),
                    zp: hashSHA256(userData.zip),
                    country: hashSHA256(userData.country),
                    ...(userData.externalId ? { external_id: hashSHA256(userData.externalId) } : {}),
                } : {}),
                // Non-hashed fields — only include IP if public (Meta rejects private IPs)
                ...(isPublicIp(userData.ipAddress) ? { client_ip_address: normaliseIp(userData.ipAddress!.trim()) } : {}),
                client_user_agent: userData.userAgent,
                fbc: userData.fbc,
                fbp: userData.fbp,
            },
        };

        // Remove undefined user_data fields
        eventData.user_data = Object.fromEntries(
            Object.entries(eventData.user_data).filter(([, v]) => v !== undefined),
        );

        // Add custom_data for purchase/ecommerce events
        if (data.payload) {
            const customData: Record<string, any> = {};

            if (data.payload.total !== undefined) {
                let value = Number(data.payload.total);
                if (config.excludeShipping) value -= Number(data.payload.shipping || 0);
                if (config.excludeTax) value -= Number(data.payload.tax || 0);
                customData.value = Math.max(0, Math.round(value * 100) / 100);
            }
            if (data.payload.currency) {
                customData.currency = data.payload.currency;
            }
            const orderId = getPayloadWooOrderIdString(data.payload);
            if (orderId) {
                customData.order_id = orderId;
            }
            if (Array.isArray(data.payload.items)) {
                customData.contents = data.payload.items.map((item: any) => ({
                    id: getContentId(item),
                    quantity: item.quantity || 1,
                    item_price: item.price || 0,
                }));
                customData.content_type = 'product';
                customData.num_items = data.payload.items.length;
            }

            // Include product category for better audience targeting
            if (Array.isArray(data.payload.categories) && data.payload.categories.length > 0) {
                customData.content_category = data.payload.categories.join(' > ');
            } else if (Array.isArray(data.payload.items) && data.payload.items[0]?.categories) {
                customData.content_category = data.payload.items[0].categories.join(' > ');
            }

            if (Object.keys(customData).length > 0) {
                eventData.custom_data = customData;
            }
        }

        const body: Record<string, any> = {
            data: [eventData],
        };

        if (testEventCode) {
            body.test_event_code = testEventCode;
        }

        return body;
    }

    /**
     * Send event to Meta with exponential backoff retry on transient failures.
     */
    private async sendWithRetry(
        pixelId: string,
        accessToken: string,
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        const url = `${GRAPH_API_BASE}/${pixelId}/events`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });

                const responseBody = await response.text();
                let parsed: any;
                try {
                    parsed = JSON.parse(responseBody);
                } catch {
                    parsed = null;
                }

                if (response.ok) {
                    if (parsed && !parsed.error && Number(parsed.events_received) > 0) {
                        await this.markDelivery(deliveryId, 'SENT', response.status, responseBody, attempt);
                        return;
                    }

                    const message = parsed?.error?.message || 'Invalid Meta CAPI success response';
                    if (this.isTransientError(response.status, parsed, message) && attempt < MAX_RETRIES) {
                        await this.backoff(attempt);
                        continue;
                    }
                    await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, message);
                    Logger.warn('[MetaCAPI] Response-level failure', { pixelId, response: responseBody.substring(0, 500) });
                    return;
                }

                // Retry rate limits, server errors, and explicit transient Graph errors.
                const responseMessage = parsed?.error?.message || responseBody;
                if (this.isTransientError(response.status, parsed, responseMessage)) {
                    Logger.warn('[MetaCAPI] Retryable error', {
                        attempt,
                        status: response.status,
                        pixelId,
                    });

                    if (attempt < MAX_RETRIES) {
                        await this.backoff(attempt);
                        continue;
                    }
                }

                // Non-retryable error (4xx except 429)
                await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, responseBody);
                Logger.warn('[MetaCAPI] Event delivery failed', {
                    status: response.status,
                    response: responseBody.substring(0, 500),
                    pixelId,
                });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) {
                    await this.markDelivery(deliveryId, 'FAILED', null, null, attempt, error.message);
                    Logger.error('[MetaCAPI] Network error after retries', { error: error.message, pixelId });
                    return;
                }
                await this.backoff(attempt);
            }
        }
    }

    private isTransientError(status: number, parsed: any, message: string): boolean {
        if (status === 429 || status >= 500 || parsed?.error?.is_transient === true) return true;
        const code = Number(parsed?.error?.code);
        if ([1, 2, 4, 17, 32, 341, 613].includes(code)) return true;
        return /rate.?limit|timeout|temporar|try again|service unavailable|internal error/i.test(message);
    }

    /** Exponential backoff: 2^attempt * 1000ms */
    private backoff(attempt: number): Promise<void> {
        const ms = Math.pow(2, attempt) * 1000;
        return new Promise((resolve) => setTimeout(resolve, ms));
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
                data: {
                    accountId,
                    platform: 'META',
                    eventName,
                    eventId,
                    payload: payload as object,
                    status: 'PENDING',
                },
            });
            return delivery.id;
        } catch (error: any) {
            Logger.error('[MetaCAPI] Failed to log delivery', { error: error.message });
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
            Logger.error('[MetaCAPI] Failed to update delivery', { deliveryId, error: error.message });
        }
    }
}
