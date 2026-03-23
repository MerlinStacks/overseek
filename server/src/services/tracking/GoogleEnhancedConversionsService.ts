/**
 * Google Ads Enhanced Conversions Service
 *
 * Uploads server-side conversion data to Google Ads via the
 * ConversionAdjustment upload API. Enhances existing conversion
 * tracking with hashed PII for better attribution matching.
 *
 * Why this approach: Google Enhanced Conversions supplement (not replace)
 * the standard Google Ads conversion tag. They use hashed customer data
 * to improve attribution when click IDs are missing or expired.
 *
 * Only purchase events are supported — Google Enhanced Conversions are
 * designed for transaction-level data, not micro-conversions.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { hashSHA256, mapEventName, extractUserData } from './conversionUtils';
import type { ConversionPlatformService } from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const MAX_RETRIES = 3;

/**
 * Google Enhanced Conversions endpoint.
 * Uses REST API instead of gRPC to avoid dependency on google-ads-api
 * for this specific upload-only use case.
 *
 * Note (Feb 2026): Google no longer accepts IP address or session attributes
 * in conversion imports via this API. Use Data Manager API for those fields.
 */
const GOOGLE_ADS_API_VERSION = 'v23';

export class GoogleEnhancedConversionsService implements ConversionPlatformService {
    readonly platform = 'GOOGLE';

    /**
     * Send a purchase conversion to Google Ads Enhanced Conversions.
     * Only processes purchase events — others are silently skipped.
     */
    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        // Google Enhanced Conversions only supports purchase events
        if (data.type !== 'purchase') return;

        const { conversionActionId, customerId } = config;
        if (!conversionActionId || !customerId) {
            Logger.warn('[GoogleEnhanced] Missing conversionActionId or customerId', { accountId });
            return;
        }

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData(data.payload, session);

        // Must have gclid or email for matching — skip if neither available
        const hasGclid = userData.clickPlatform === 'google' && userData.clickId;
        const hasEmail = !!userData.email;

        if (!hasGclid && !hasEmail) {
            Logger.debug('[GoogleEnhanced] Skipping — no gclid or email for matching', { accountId });
            return;
        }

        // Look up OAuth tokens from AdAccount linked to this Google Ads customer ID
        const adAccount = await prisma.adAccount.findFirst({
            where: { accountId, platform: 'GOOGLE', externalId: customerId },
            select: { id: true, accessToken: true, refreshToken: true },
        });

        if (!adAccount?.refreshToken) {
            Logger.warn('[GoogleEnhanced] No Google Ads account with valid tokens found', {
                accountId,
                customerId,
            });
            return;
        }

        const payload = this.buildPayload(conversionActionId, customerId, eventId, data, userData, !!hasGclid);
        const deliveryId = await this.logDelivery(accountId, 'purchase', eventId, payload);

        await this.sendWithRetry(customerId, adAccount, payload, deliveryId);
    }

    /**
     * Build Google Ads ConversionAdjustment payload.
     * Spec: https://developers.google.com/google-ads/api/docs/conversions/upload-adjustments
     */
    private buildPayload(
        conversionActionId: string,
        customerId: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
        hasGclid: boolean,
    ): Record<string, any> {
        const adjustment: Record<string, any> = {
            conversionAction: `customers/${customerId.replace(/-/g, '')}/conversionActions/${conversionActionId}`,
            adjustmentType: 'ENHANCEMENT',
            orderId: data.payload?.orderId ? String(data.payload.orderId) : eventId,
            adjustmentDateTime: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00:00'),
            userIdentifiers: [],
        };

        // Add gclid if available — strongest matching signal
        if (hasGclid && userData.clickId) {
            adjustment.gclidDateTimePair = {
                gclid: userData.clickId,
                conversionDateTime: adjustment.adjustmentDateTime,
            };
        }

        // Add hashed email — SHA-256, lowercase, trimmed
        if (userData.email) {
            adjustment.userIdentifiers.push({
                hashedEmail: hashSHA256(userData.email),
            });
        }

        // Add hashed phone if available
        if (userData.phone) {
            adjustment.userIdentifiers.push({
                hashedPhoneNumber: hashSHA256(userData.phone),
            });
        }

        // Add address info if available
        if (userData.firstName || userData.lastName) {
            const addressInfo: Record<string, any> = {};
            if (userData.firstName) addressInfo.hashedFirstName = hashSHA256(userData.firstName);
            if (userData.lastName) addressInfo.hashedLastName = hashSHA256(userData.lastName);
            if (userData.city) addressInfo.city = userData.city;
            if (userData.state) addressInfo.state = userData.state;
            if (userData.zip) addressInfo.postalCode = userData.zip;
            if (userData.country) addressInfo.countryCode = userData.country;

            adjustment.userIdentifiers.push({ addressInfo });
        }

        // Restatement value (conversion value)
        if (data.payload?.total !== undefined) {
            adjustment.restatementValue = {
                adjustedValue: data.payload.total,
                currencyCode: data.payload.currency || 'USD',
            };
        }

        return {
            conversionAdjustments: [adjustment],
            partialFailure: true,
        };
    }

    /**
     * Send with exponential backoff retry.
     * Uses Google Ads REST API for conversion adjustment upload.
     */
    private async sendWithRetry(
        customerId: string,
        adAccount: { id: string; accessToken: string; refreshToken: string | null },
        payload: Record<string, any>,
        deliveryId: string,
    ): Promise<void> {
        const cleanCustomerId = customerId.replace(/-/g, '');
        const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}:uploadConversionAdjustments`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${adAccount.accessToken}`,
                        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
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
                Logger.error('[GoogleEnhanced] Upload failed', { status: response.status, customerId });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) {
                    await this.markDelivery(deliveryId, 'FAILED', null, null, attempt, error.message);
                    Logger.error('[GoogleEnhanced] Network error after retries', { error: error.message });
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
                data: { accountId, platform: 'GOOGLE', eventName, eventId, payload: payload as object, status: 'PENDING' },
            });
            return d.id;
        } catch (error: any) {
            Logger.error('[GoogleEnhanced] Failed to log delivery', { error: error.message });
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
            Logger.error('[GoogleEnhanced] Failed to update delivery', { id, error: error.message });
        }
    }
}
