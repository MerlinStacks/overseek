/**
 * Microsoft Advertising Conversions API Service
 *
 * Sends server-side conversion events to Microsoft/Bing Ads.
 * Endpoint: POST https://bat.bing.com/api/v2/conversion/event
 *
 * Why: msclkid is captured in server-side tracking but without CAPI,
 * server-side attribution to Bing Ads campaigns is lost entirely.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { hashSHA256, mapEventName, extractUserData } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const BING_API_URL = 'https://bat.bing.com/api/v2/conversion/event';
const MAX_RETRIES = 3;

export class MicrosoftCAPIService implements ConversionPlatformService {
    readonly platform = 'MICROSOFT';

    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        const { tagId, accessToken } = config;
        if (!tagId || !accessToken) {
            Logger.warn('[MicrosoftCAPI] Missing tagId or accessToken', { accountId });
            return;
        }

        const eventName = mapEventName(data.type, 'MICROSOFT');
        if (!eventName) return;

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData(data.payload, session);
        const payload = this.buildPayload(tagId, eventName, eventId, data, userData);

        const deliveryId = await this.logDelivery(accountId, eventName, eventId, payload);
        await this.sendWithRetry(accessToken, payload, deliveryId);
    }

    private buildPayload(
        tagId: string,
        eventName: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
    ): Record<string, any> {
        const event: Record<string, any> = {
            tag_id: tagId,
            event_type: eventName,
            event_id: eventId,
            timestamp: new Date().toISOString(),
            page_url: data.url,
        };

        // Enhanced conversions — hashed PII for matching
        const enhancedConversions: Record<string, any> = {};
        if (userData.email) enhancedConversions.hashed_email = hashSHA256(userData.email);
        if (userData.phone) enhancedConversions.hashed_phone_number = hashSHA256(userData.phone);
        if (Object.keys(enhancedConversions).length > 0) {
            event.enhanced_conversions = [enhancedConversions];
        }

        // Click ID for attribution — check both URL param path and cookie-forwarded path
        const msclkid = userData.msclkid
            || (userData.clickId && userData.clickPlatform === 'microsoft' ? userData.clickId : undefined);
        if (msclkid) {
            event.msclkid = msclkid;
        }

        // User agent and IP
        if (userData.userAgent) event.user_agent = userData.userAgent;
        if (userData.ipAddress) event.client_ip_address = userData.ipAddress;

        // Revenue data
        if (data.payload) {
            if (data.payload.total !== undefined) event.revenue_value = data.payload.total;
            if (data.payload.currency) event.revenue_currency = data.payload.currency;
            if (data.payload.orderId) event.variable_revenue = String(data.payload.orderId);
        }

        return event;
    }

    private async sendWithRetry(
        accessToken: string,
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(BING_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `SharedAccessSignature ${accessToken}`,
                    },
                    body: JSON.stringify({ events: [payload] }),
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
                Logger.error('[MicrosoftCAPI] Delivery failed', { status: response.status });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) {
                    await this.markDelivery(deliveryId, 'FAILED', null, null, attempt, error.message);
                    Logger.error('[MicrosoftCAPI] Network error after retries', { error: error.message });
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
                data: { accountId, platform: 'MICROSOFT', eventName, eventId, payload: payload as object, status: 'PENDING' },
            });
            return d.id;
        } catch (error: any) {
            Logger.error('[MicrosoftCAPI] Failed to log delivery', { error: error.message });
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
            Logger.error('[MicrosoftCAPI] Failed to update delivery', { id, error: error.message });
        }
    }
}
