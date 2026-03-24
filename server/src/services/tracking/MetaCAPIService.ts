/**
 * Meta CAPI Service
 *
 * Sends server-side conversion events to Meta (Facebook/Instagram)
 * Conversions API: POST https://graph.facebook.com/v24.0/{pixelId}/events
 *
 * Why server-side: Browser-side Meta Pixel is blocked by ~30% of users
 * via ad blockers. CAPI sends the same events server-to-server for
 * complete attribution data.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { hashSHA256, mapEventName, extractUserData } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const API_VERSION = 'v25.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Max retry attempts for transient failures */
const MAX_RETRIES = 3;

/**
 * Check if an IP address is a public routable address.
 * Meta CAPI rejects private, loopback, and link-local IPs.
 */
function isPublicIp(ip: string | undefined): boolean {
    if (!ip || ip === '') return false;
    // IPv4 private ranges + loopback
    if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.)/.test(ip)) return false;
    // IPv6 loopback and link-local
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return false;
    return true;
}

export class MetaCAPIService implements ConversionPlatformService {
    readonly platform = 'META';

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
        const userData = extractUserData(data.payload, session);
        const payload = this.buildPayload(eventName, eventId, data, userData, testEventCode);

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
        testEventCode?: string,
    ): Record<string, any> {
        const eventData: Record<string, any> = {
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            event_id: eventId,
            action_source: 'website',
            event_source_url: data.url,
            user_data: {
                // Hash all PII fields — Meta requires SHA-256
                em: hashSHA256(userData.email),
                ph: hashSHA256(userData.phone),
                fn: hashSHA256(userData.firstName),
                ln: hashSHA256(userData.lastName),
                ct: hashSHA256(userData.city),
                st: hashSHA256(userData.state),
                zp: hashSHA256(userData.zip),
                country: hashSHA256(userData.country),
                // Non-hashed fields — only include IP if public (Meta rejects private IPs)
                ...(isPublicIp(userData.ipAddress) ? { client_ip_address: userData.ipAddress } : {}),
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
                customData.value = data.payload.total;
            }
            if (data.payload.currency) {
                customData.currency = data.payload.currency;
            }
            if (data.payload.orderId) {
                customData.order_id = String(data.payload.orderId);
            }
            if (Array.isArray(data.payload.items)) {
                customData.contents = data.payload.items.map((item: any) => ({
                    id: String(item.id || item.sku || ''),
                    quantity: item.quantity || 1,
                    item_price: item.price || 0,
                }));
                customData.content_type = 'product';
                customData.num_items = data.payload.items.length;
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
        const url = `${GRAPH_API_BASE}/${pixelId}/events?access_token=${accessToken}`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                const responseBody = await response.text();

                if (response.ok) {
                    await this.markDelivery(deliveryId, 'SENT', response.status, responseBody, attempt);
                    return;
                }

                // Retry on 429 (rate limited) or 5xx (server error)
                if (response.status === 429 || response.status >= 500) {
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
                Logger.error('[MetaCAPI] Event delivery failed', {
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
