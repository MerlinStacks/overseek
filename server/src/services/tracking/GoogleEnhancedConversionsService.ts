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
import { getCredentials } from '../ads/types';
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
        const userData = extractUserData(data.payload, session, data.ipAddress);

        // Must have gclid or email for matching — skip if neither available
        const hasGclid = userData.clickPlatform === 'google' && userData.clickId;
        const hasEmail = !!userData.email;

        if (!hasGclid && !hasEmail) {
            Logger.debug('[GoogleEnhanced] Skipping — no gclid or email for matching', { accountId });
            return;
        }

        // Look up OAuth tokens from AdAccount linked to this Google Ads customer ID.
        // Normalize: complete-setup stores externalId without dashes, so strip them here.
        const normalizedCustomerId = customerId.replace(/-/g, '');
        const adAccount = await prisma.adAccount.findFirst({
            where: { accountId, platform: 'GOOGLE', externalId: normalizedCustomerId },
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
        // Use the order's actual creation time if provided by the plugin.
        // Falling back to now is acceptable for real-time events but the
        // conversionDateTime MUST be close to when the Google Ads tag fired
        // on the thank-you page so Google can match the enhancement to its
        // existing conversion record.
        const orderDate = data.payload?.date || data.payload?.orderDate || data.payload?.dateCreated;
        const conversionTime = orderDate
            ? new Date(orderDate).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00:00')
            : new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00:00');

        const orderId = data.payload?.orderId ? String(data.payload.orderId) : eventId;

        const adjustment: Record<string, any> = {
            conversionAction: `customers/${customerId.replace(/-/g, '')}/conversionActions/${conversionActionId}`,
            adjustmentType: 'ENHANCEMENT',
            orderId,
            adjustmentDateTime: conversionTime,
            userIdentifiers: [],
        };

        // Add gclid if available — strongest matching signal.
        // conversionDateTime must match when the Google Ads tag originally
        // recorded the conversion (i.e. when the order was placed), not when
        // this API call is made.
        if (hasGclid && userData.clickId) {
            adjustment.gclidDateTimePair = {
                gclid: userData.clickId,
                conversionDateTime: conversionTime,
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
     * Retry failed enhanced conversion deliveries for an account within a time window.
     * Helpful for recovering from transient API errors or invalid credentials.
     */
    async retryFailedDeliveries(accountId: string, hoursBack: number = 8): Promise<{ attempted: number; recovered: number }> {
        const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
        
        const failedDeliveries = await prisma.conversionDelivery.findMany({
            where: {
                accountId,
                platform: 'GOOGLE',
                status: 'FAILED',
                createdAt: { gte: since }
            }
        });

        if (failedDeliveries.length === 0) return { attempted: 0, recovered: 0 };

        // Need the ad account to get the tokens and externalId (customer ID)
        const adAccount = await prisma.adAccount.findFirst({
            where: { accountId, platform: 'GOOGLE', refreshToken: { not: null } },
            select: { id: true, accessToken: true, refreshToken: true, externalId: true },
        });

        if (!adAccount || !adAccount.externalId) {
            Logger.warn('[GoogleEnhanced] Cannot retry: missing ad account or credentials', { accountId });
            return { attempted: failedDeliveries.length, recovered: 0 };
        }

        Logger.info(`[GoogleEnhanced] Retrying ${failedDeliveries.length} failed conversions`, { accountId });

        let recovered = 0;
        for (const delivery of failedDeliveries) {
            try {
                // Set back to pending so metrics don't double count if it fails again
                await prisma.conversionDelivery.update({
                    where: { id: delivery.id },
                    data: { status: 'PENDING', attempts: delivery.attempts + 1 }
                });

                await this.sendWithRetry(
                    adAccount.externalId,
                    adAccount as any,
                    delivery.payload as Record<string, any>,
                    delivery.id
                );

                const updated = await prisma.conversionDelivery.findUnique({
                    where: { id: delivery.id },
                    select: { status: true }
                });

                if (updated?.status === 'SENT') {
                    recovered++;
                }
            } catch (error) {
                Logger.error('[GoogleEnhanced] Error retrying delivery', { deliveryId: delivery.id, error });
            }
        }

        return { attempted: failedDeliveries.length, recovered };
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

        // Fetch credentials from the database/environment
        const creds = await getCredentials('GOOGLE_ADS');
        const developerToken = creds?.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
        const loginCustomerId = creds?.loginCustomerId || process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID || '';

        // Refresh the access token before sending to avoid stale-token 400/401s.
        // GoogleAdsClient's createGoogleAdsClient does this for gRPC calls,
        // but Enhanced Conversions uses REST directly and needs its own refresh.
        const accessToken = await this.refreshToken(adAccount);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                    'developer-token': developerToken,
                };
                
                if (loginCustomerId) {
                    headers['login-customer-id'] = loginCustomerId.replace(/-/g, '');
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                });

                const responseBody = await response.text();

                if (response.ok) {
                    // Google Ads API returns HTTP 200 even for rejected conversions when
                    // partialFailure=true. A partialFailureError in the body means the
                    // conversion was not accepted — treat it as a failure so the delivery
                    // log reflects reality and the UI shows actionable errors.
                    let parsed: any;
                    try { parsed = JSON.parse(responseBody); } catch { parsed = null; }

                    if (parsed?.partialFailureError) {
                        const errMsg = parsed.partialFailureError.message || JSON.stringify(parsed.partialFailureError);
                        await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, errMsg);
                        Logger.error('[GoogleEnhanced] Partial failure — conversion rejected by Google', {
                            customerId,
                            partialFailureError: parsed.partialFailureError,
                        });
                        return;
                    }

                    // Log whether Google returned results or an empty array.
                    // An empty results array means no base conversion was found to
                    // enhance — usually because the Google Ads tag didn't fire on
                    // the thank-you page, or the orderId doesn't match the tag's
                    // transaction_id parameter.
                    const resultCount = parsed?.results?.length ?? 0;
                    if (resultCount === 0) {
                        Logger.warn('[GoogleEnhanced] Upload accepted but no conversions matched — check that the Google Ads tag fires on the WooCommerce thank-you page and that transaction_id matches orderId', {
                            customerId,
                            orderId: payload.conversionAdjustments?.[0]?.orderId,
                            hasGclid: !!payload.conversionAdjustments?.[0]?.gclidDateTimePair,
                            userIdentifierCount: payload.conversionAdjustments?.[0]?.userIdentifiers?.length ?? 0,
                        });
                    } else {
                        Logger.info('[GoogleEnhanced] Conversion enhancement matched successfully', {
                            customerId,
                            resultCount,
                            orderId: payload.conversionAdjustments?.[0]?.orderId,
                        });
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
                Logger.error('[GoogleEnhanced] Upload failed', {
                    status: response.status,
                    customerId,
                    body: responseBody.substring(0, 500),
                });
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

    /**
     * Refresh the OAuth access token via Google's token endpoint.
     * Falls back to the stored token if refresh fails or no refresh token exists.
     */
    private async refreshToken(
        adAccount: { id: string; accessToken: string; refreshToken: string | null },
    ): Promise<string> {
        if (!adAccount.refreshToken) return adAccount.accessToken;

        try {
            const creds = await getCredentials('GOOGLE_ADS');
            if (!creds?.clientId || !creds?.clientSecret) return adAccount.accessToken;

            const params = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: adAccount.refreshToken,
                client_id: creds.clientId,
                client_secret: creds.clientSecret,
            });

            const resp = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
            });

            const data = await resp.json();
            if (data.access_token) {
                // Persist so other callers get the fresh token too
                await prisma.adAccount.update({
                    where: { id: adAccount.id },
                    data: { accessToken: data.access_token },
                }).catch(() => { /* best-effort */ });
                return data.access_token;
            }

            Logger.warn('[GoogleEnhanced] Token refresh returned no access_token', {
                error: data.error,
                description: data.error_description,
            });
            return adAccount.accessToken;
        } catch (err: any) {
            Logger.warn('[GoogleEnhanced] Token refresh failed, using stored token', { error: err.message });
            return adAccount.accessToken;
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
