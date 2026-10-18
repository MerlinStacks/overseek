/**
 * Google Ads Enhanced Conversions Service
 *
 * Existing WEBPAGE actions use enhancement adjustments. An explicitly
 * configured UPLOAD_CLICKS purchase action creates independent server-side
 * purchases, including when a browser tag was missed. These action types
 * are not interchangeable and do not deduplicate against each other.
 *
 * Supports per-event conversion actions: purchase, add_to_cart,
 * begin_checkout, and view_item. Each event type can have its own
 * conversionActionId. Falls back to the single `conversionActionId`
 * for backward compatibility.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { redisClient } from '../../utils/redis';
import { getPayloadWooOrderIdString } from '../../utils/orderIds';
import { hashSHA256, mapEventName, extractUserData, normalizePhoneE164, resolveConversionEventDate } from './conversionUtils';
import { getCredentials } from '../ads/types';
import { ensureGoogleAdsAccessToken } from '../ads/GoogleAdsClient';
import type {
    ConversionPlatformService,
    StoredConversionDelivery,
    StoredDeliveryRetryResult,
} from './ConversionForwarder';
import type { TrackingEventPayload } from './EventProcessor';

const MAX_RETRIES = 3;
const MAX_CART_ITEMS = 20;
const NON_RETRYABLE_PREFIX = 'NON_RETRYABLE:';
const QUOTA_COOLDOWN_FALLBACK_MS = 60 * 60 * 1000;
const QUOTA_COOLDOWN_REDIS_PREFIX = 'tracking:google:quota-cooldown-until';
const REQUEST_PACING_REDIS_PREFIX = 'tracking:google:request-next-allowed-ms';
const REQUEST_PACING_INTERVAL_MS = 1500;
const REQUEST_TIMEOUT_MS = 10_000;

type NormalizedBasketItem = {
    productId: string;
    quantity: number;
    unitPrice: number;
};

/**
 * Google Enhanced Conversions endpoint.
 * Uses REST API instead of gRPC to avoid dependency on google-ads-api
 * for this specific upload-only use case.
 *
 * Note (Feb 2026): Google no longer accepts IP address or session attributes
 * in conversion imports via this API. Use Data Manager API for those fields.
 */
const GOOGLE_ADS_API_VERSION = 'v24';

export class GoogleEnhancedConversionsService implements ConversionPlatformService {
    readonly platform = 'GOOGLE';
    private static quotaCooldownUntilMsByCustomer = new Map<string, number>();

    /** Read-only connectivity/action check. Never sends a synthetic purchase. */
    async validateConfiguration(accountId: string, config: Record<string, any>): Promise<string> {
        const customerId = String(config.customerId || '').replace(/-/g, '');
        const actionId = String(config.purchaseUploadActionId || config.conversionActionId || '');
        if (!/^\d{10}$/.test(customerId) || !/^\d+$/.test(actionId)) throw new Error('Configure a valid Google customer ID and numeric purchase action ID first');
        const account = await prisma.adAccount.findFirst({ where: { accountId, platform: 'GOOGLE', externalId: customerId }, select: { id: true, accessToken: true, refreshToken: true, updatedAt: true } });
        if (!account?.refreshToken) throw new Error('Connect the matching Google Ads account first');
        const accessToken = await this.refreshToken(account);
        const creds = await getCredentials('GOOGLE_ADS');
        const manager = creds?.loginCustomerId || process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID;
        const query = async (query: string) => {
            const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`, {
                method: 'POST', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`,
                    'developer-token': creds?.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
                    ...(manager ? { 'login-customer-id': manager.replace(/-/g, '') } : {}) },
                body: JSON.stringify({ query }),
            });
            const result = await response.json() as any;
            if (!response.ok || result.error) throw new Error(`Google configuration check failed (${response.status}). Check account access and API eligibility.`);
            return result.results || [];
        };
        const rows = await query(`SELECT conversion_action.id, conversion_action.type, conversion_action.status FROM conversion_action WHERE conversion_action.id = ${actionId}`);
        const action = rows[0]?.conversionAction;
        const expected = config.purchaseUploadActionId ? 'UPLOAD_CLICKS' : 'WEBPAGE';
        if (action?.type !== expected || action?.status !== 'ENABLED') throw new Error(`Purchase action must be ENABLED and type ${expected}; check the action ID and conversion-owning account`);
        const customers = await query('SELECT customer.conversion_tracking_setting.accepted_customer_data_terms FROM customer');
        if (customers[0]?.customer?.conversionTrackingSetting?.acceptedCustomerDataTerms !== true) throw new Error('Accept Google customer-data terms before sending customer identifiers');
        return config.purchaseUploadActionId
            ? 'Independent purchase import action and account access verified. No purchase was sent. Validate real orders in Google upload diagnostics; keep only one purchase action Primary.'
            : 'Website enhancement action and account access verified. This mode still requires a matching browser purchase. Configure an independent purchase import action for server-created purchases.';
    }

    /**
     * Send a conversion to Google Ads Enhanced Conversions.
     * Supports purchase, add_to_cart, begin_checkout, and view_item events.
     * Each event type can have its own conversionActionId via per-event config
     * (e.g. conversionActionIdAddToCart). Falls back to the single
     * conversionActionId for backward compatibility (purchase only).
     */
    async sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        const eventName = mapEventName(data.type, 'GOOGLE');
        if (!eventName) return;

        // An import action creates purchases independently of the website tag.
        // Never upload clicks against the existing WEBPAGE enhancement action.
        const independentPurchase = data.type === 'purchase' && !!config.purchaseUploadActionId;
        const conversionActionId = independentPurchase ? config.purchaseUploadActionId : this.getConversionActionId(config, data.type);
        const { customerId } = config;

        if (!conversionActionId || !customerId) {
            Logger.debug('[GoogleEnhanced] No conversionActionId for event type or missing customerId', { accountId, eventType: data.type });
            return;
        }

        const eventId = data.eventId || crypto.randomUUID();
        const userData = extractUserData({
            ...data.payload,
            email: data.email ?? data.payload?.email,
            clickId: data.clickId ?? data.payload?.clickId,
            clickPlatform: data.clickPlatform ?? data.payload?.clickPlatform,
        }, session, data.ipAddress);

        const isPurchase = data.type === 'purchase';
        const isEnhancement = isPurchase && !independentPurchase;
        const hasGclid = userData.clickPlatform === 'google' && userData.clickId;
        const hasUserIdentifier = !!userData.email
            || !!normalizePhoneE164(userData.phone, userData.country)
            || (isEnhancement && !!(userData.firstName && userData.lastName && userData.country && userData.zip));

        // Purchase enhancements require hashed user data. Click conversions can
        // also be matched directly with a Google click ID.
        if (data.consentState === 'denied' || (!hasUserIdentifier && (isEnhancement || !hasGclid))) {
            Logger.debug('[GoogleEnhanced] Skipping — no valid user identifier or gclid for matching', { accountId });
            return;
        }

        // Look up OAuth tokens from AdAccount linked to this Google Ads customer ID.
        // Normalize: complete-setup stores externalId without dashes, so strip them here.
        const normalizedCustomerId = customerId.replace(/-/g, '');
        const adAccount = await prisma.adAccount.findFirst({
            where: { accountId, platform: 'GOOGLE', externalId: normalizedCustomerId },
            select: { id: true, accessToken: true, refreshToken: true, updatedAt: true },
        });

        if (!adAccount?.refreshToken) {
            Logger.warn('[GoogleEnhanced] No Google Ads account with valid tokens found', {
                accountId,
                customerId,
            });
            return;
        }

        const payload = isEnhancement
            ? this.buildEnhancementPayload(conversionActionId, customerId, eventId, data, userData)
            : this.buildConversionPayload(conversionActionId, customerId, eventId, data, userData, !!hasGclid);

        const googleEventName = mapEventName(data.type, 'GOOGLE')!;
        const deliveryId = await this.logDelivery(accountId, googleEventName, eventId, payload);
        const cooldownUntil = await this.getActiveQuotaCooldownUntil(customerId);
        if (cooldownUntil) {
            // Preserve the original order/time for scheduled retry instead of dropping it.
            await this.markDelivery(deliveryId, 'FAILED', 429, null, 0, 'Google quota cooldown active; retry this stored conversion after the cooldown');
            Logger.warn('[GoogleEnhanced] Upload skipped due to active quota cooldown', {
                accountId,
                customerId,
                retryAt: new Date(cooldownUntil).toISOString(),
            });
            return;
        }

        await this.sendWithRetry(customerId, adAccount, payload, deliveryId, isEnhancement);
    }

    private parseNumber(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    }

    private normalizeBasketItems(payload: Record<string, any> | undefined): NormalizedBasketItem[] {
        const rawItems = payload?.items;
        if (!Array.isArray(rawItems)) return [];

        return rawItems
            .slice(0, MAX_CART_ITEMS)
            .map((item) => {
                if (!item || typeof item !== 'object') return null;

                const rawId = item.sku || item.contentId || item.id || item.productId || item.variationId;
                const productId = rawId !== undefined && rawId !== null ? String(rawId).trim() : '';
                if (!productId) return null;

                const quantity = this.parseNumber(item.quantity) ?? 1;
                const unitPriceRaw = this.parseNumber(item.unitPrice) ?? this.parseNumber(item.price);
                const unitPrice = unitPriceRaw ?? 0;

                return {
                    productId,
                    quantity: quantity > 0 ? quantity : 1,
                    unitPrice: unitPrice >= 0 ? unitPrice : 0,
                };
            })
            .filter((item): item is NormalizedBasketItem => item !== null);
    }

    /**
     * Resolve the conversionActionId for a given event type.
     * Per-event IDs (e.g. conversionActionIdAddToCart) take precedence.
     * Falls back to the single conversionActionId for purchase only.
     */
    private getConversionActionId(config: Record<string, any>, eventType: string): string | undefined {
        const PER_EVENT_KEY: Record<string, string> = {
            // purchase maps to the legacy single field for backward compatibility
            purchase: 'conversionActionId',
            add_to_cart: 'conversionActionIdAddToCart',
            checkout_start: 'conversionActionIdBeginCheckout',
            product_view: 'conversionActionIdViewItem',
        };

        const key = PER_EVENT_KEY[eventType];
        if (!key) return undefined;

        return config[key] || undefined;
    }

    /**
     * Build Google Ads ConversionAdjustment payload (purchase enhancements).
     * Spec: https://developers.google.com/google-ads/api/docs/conversions/upload-adjustments
     */
    private buildEnhancementPayload(
        conversionActionId: string,
        customerId: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
    ): Record<string, any> {
        const orderId = getPayloadWooOrderIdString(data.payload) || eventId;

        const adjustment: Record<string, any> = {
            conversionAction: `customers/${customerId.replace(/-/g, '')}/conversionActions/${conversionActionId}`,
            adjustmentType: 'ENHANCEMENT',
            orderId,
            // This is the adjustment submission time, not the original order time.
            adjustmentDateTime: this.googleDateTimeNow(),
            userIdentifiers: [],
        };

        // Add hashed email — SHA-256, lowercase, trimmed
        if (userData.email) {
            adjustment.userIdentifiers.push({
                hashedEmail: hashSHA256(userData.email, 'email'),
            });
        }

        // Add hashed phone if available
        const normalizedPhone = normalizePhoneE164(userData.phone, userData.country);
        if (normalizedPhone) {
            adjustment.userIdentifiers.push({
                hashedPhoneNumber: hashSHA256(normalizedPhone),
            });
        }

        // Google requires the full name, country, and postal code for address matching.
        if (userData.firstName && userData.lastName && userData.country && userData.zip) {
            const addressInfo: Record<string, any> = {
                hashedFirstName: hashSHA256(userData.firstName),
                hashedLastName: hashSHA256(userData.lastName),
                postalCode: userData.zip,
                countryCode: userData.country,
            };
            if (userData.city) addressInfo.city = userData.city;
            if (userData.state) addressInfo.state = userData.state;

            adjustment.userIdentifiers.push({ addressInfo });
        }

        return {
            conversionAdjustments: [adjustment],
            partialFailure: true,
        };
    }

    private sanitizeEnhancementPayload(payload: Record<string, any>): Record<string, any> {
        const sanitized = structuredClone(payload);
        for (const adjustment of sanitized.conversionAdjustments || []) {
            if (adjustment.adjustmentType === 'ENHANCEMENT') {
                delete adjustment.restatementValue;
            }
            if (adjustment.orderId) {
                delete adjustment.gclidDateTimePair;
            }
            adjustment.adjustmentDateTime = this.googleDateTimeNow();
        }
        return sanitized;
    }

    async retryStoredDelivery(delivery: StoredConversionDelivery): Promise<StoredDeliveryRetryResult> {
        const storedPayload = delivery.payload as Record<string, any>;
        const isEnhancement = Array.isArray(storedPayload?.conversionAdjustments);
        const payload = isEnhancement
            ? this.sanitizeEnhancementPayload(storedPayload)
            : structuredClone(storedPayload);
        const conversion = payload.conversionAdjustments?.[0] || payload.conversions?.[0];
        const customerId = String(conversion?.conversionAction || '').match(/^customers\/(\d+)\/conversionActions\//)?.[1];

        if (!customerId) {
            return { status: 'FAILED', httpStatus: null, response: null, lastError: 'Stored Google payload has no valid customer ID' };
        }

        const adAccount = await prisma.adAccount.findFirst({
            where: { accountId: delivery.accountId, platform: 'GOOGLE', externalId: customerId },
            select: { id: true, accessToken: true, refreshToken: true, updatedAt: true },
        });
        if (!adAccount?.refreshToken) {
            return { status: 'FAILED', httpStatus: null, response: null, lastError: 'Google Ads OAuth credentials are unavailable' };
        }

        const cooldownUntil = await this.getActiveQuotaCooldownUntil(customerId);
        if (cooldownUntil) {
            return {
                status: 'FAILED',
                httpStatus: 429,
                response: null,
                lastError: `Google Ads quota cooldown active until ${new Date(cooldownUntil).toISOString()}`,
            };
        }

        const creds = await getCredentials('GOOGLE_ADS');
        const developerToken = creds?.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
        const loginCustomerId = creds?.loginCustomerId || process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID || '';
        const accessToken = await this.refreshToken(adAccount);
        const action = isEnhancement ? 'uploadConversionAdjustments' : 'uploadClickConversions';
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
        };
        if (loginCustomerId) headers['login-customer-id'] = loginCustomerId.replace(/-/g, '');

        await this.enforcePerCustomerRequestPacing(customerId);
        const response = await fetch(
            `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:${action}`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            },
        );
        const responseBody = await response.text();
        let parsed: any;
        try { parsed = JSON.parse(responseBody); } catch { parsed = null; }
        if (response.ok && !parsed?.partialFailureError && parsed?.results?.length > 0) {
            return { status: 'SENT', httpStatus: response.status, response: responseBody, lastError: null };
        }

        if (response.status === 429) {
            await this.setQuotaCooldown(customerId, this.extractRetryAfterMs(response, responseBody));
        }
        const lastError = parsed?.partialFailureError
            ? this.normalizeGoogleErrorMessage(parsed.partialFailureError)
            : response.ok ? 'Google returned no conversion result; delivery is unconfirmed' : responseBody || `HTTP ${response.status}`;
        return { status: 'FAILED', httpStatus: response.status, response: responseBody, lastError };
    }

    /**
     * Build an independent ClickConversion for an explicitly configured import
     * action, including purchases. Never send these to a website action.
     * Spec: https://developers.google.com/google-ads/api/docs/conversions/upload-online
     */
    private buildConversionPayload(
        conversionActionId: string,
        customerId: string,
        eventId: string,
        data: TrackingEventPayload,
        userData: ReturnType<typeof extractUserData>,
        hasGclid: boolean,
    ): Record<string, any> {
        const conversionTime = resolveConversionEventDate(data.occurredAt, data.payload).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00:00');
        const cleanCustomerId = customerId.replace(/-/g, '');

        const conversion: Record<string, any> = {
            conversionAction: `customers/${cleanCustomerId}/conversionActions/${conversionActionId}`,
            conversionDateTime: conversionTime,
            // Deduplication is per import action, NOT across website/import actions.
            orderId: data.type === 'purchase' ? getPayloadWooOrderIdString(data.payload) || eventId : eventId,
            userIdentifiers: [],
        };

        // gclid is the strongest matching signal
        if (hasGclid && userData.clickId) {
            conversion.gclid = userData.clickId;
        }

        // Hashed email
        if (userData.email) {
            conversion.userIdentifiers.push({
                hashedEmail: hashSHA256(userData.email, 'email'),
            });
        }

        // Hashed phone
        const normalizedPhone = normalizePhoneE164(userData.phone, userData.country);
        if (normalizedPhone) {
            conversion.userIdentifiers.push({
                hashedPhoneNumber: hashSHA256(normalizedPhone),
            });
        }

        // UploadClickConversions only accepts email/phone identifiers, not addresses.
        if (data.consentState === 'granted') conversion.consent = { adUserData: 'GRANTED' };
        if (conversion.userIdentifiers.length === 0) delete conversion.userIdentifiers;

        // Conversion value (e.g. cart value for add_to_cart)
        if (data.payload?.total !== undefined || data.payload?.value !== undefined) {
            conversion.conversionValue = data.payload.total ?? data.payload.value;
            conversion.currencyCode = data.payload.currency || 'USD';
        }

        const basketItems = this.normalizeBasketItems(data.payload);
        if (basketItems.length > 0) {
            conversion.cartData = {
                items: basketItems,
            };
        }

        return {
            conversions: [conversion],
            partialFailure: true,
        };
    }

    /**
     * Retry failed enhanced conversion deliveries for an account within a time window.
     * Helpful for recovering from transient API errors or invalid credentials.
     */
    async retryFailedDeliveries(accountId: string, hoursBack: number = 8): Promise<{ attempted: number; recovered: number }> {
        const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

        // Also pick up SENT records where Google silently rejected the conversion
        // via partialFailureError (HTTP 200 but not actually accepted). This happened
        // for all deliveries before the partialFailureError check was added.
        const [failedDeliveries, falseSentDeliveries] = await Promise.all([
            prisma.conversionDelivery.findMany({
                where: {
                    accountId,
                    platform: 'GOOGLE',
                    status: 'FAILED',
                    createdAt: { gte: since },
                    lastError: { not: { startsWith: NON_RETRYABLE_PREFIX } },
                },
            }),
            prisma.conversionDelivery.findMany({
                where: {
                    accountId,
                    platform: 'GOOGLE',
                    status: 'SENT',
                    createdAt: { gte: since },
                    response: { contains: 'partialFailureError' },
                },
            }),
        ]);

        // Re-mark false-SENT records so they go through the normal retry path
        if (falseSentDeliveries.length > 0) {
            await prisma.conversionDelivery.updateMany({
                where: { id: { in: falseSentDeliveries.map(d => d.id) } },
                data: { status: 'FAILED', lastError: 'Reclassified: partialFailureError detected in response' },
            });
            Logger.warn(`[GoogleEnhanced] Reclassified ${falseSentDeliveries.length} false-SENT deliveries as FAILED for retry`, { accountId });
        }

        const allToRetry = [...failedDeliveries, ...falseSentDeliveries];

        if (allToRetry.length === 0) return { attempted: 0, recovered: 0 };

        // Need the ad account to get the tokens and externalId (customer ID)
        const adAccount = await prisma.adAccount.findFirst({
            where: { accountId, platform: 'GOOGLE', refreshToken: { not: null } },
            select: { id: true, accessToken: true, refreshToken: true, externalId: true, updatedAt: true },
        });

        if (!adAccount || !adAccount.externalId) {
            Logger.warn('[GoogleEnhanced] Cannot retry: missing ad account or credentials', { accountId });
            return { attempted: failedDeliveries.length, recovered: 0 };
        }

        Logger.warn(`[GoogleEnhanced] Retrying ${allToRetry.length} conversions`, { accountId });

        const cooldownUntil = await this.getActiveQuotaCooldownUntil(adAccount.externalId);
        if (cooldownUntil) {
            Logger.warn('[GoogleEnhanced] Retry skipped due to active quota cooldown', {
                accountId,
                customerId: adAccount.externalId,
                retryAt: new Date(cooldownUntil).toISOString(),
            });
            return { attempted: 0, recovered: 0 };
        }

        let recovered = 0;
        for (const delivery of allToRetry) {
            try {
                // Set back to pending so metrics don't double count if it fails again
                await prisma.conversionDelivery.update({
                    where: { id: delivery.id },
                    data: { status: 'PENDING', attempts: delivery.attempts + 1 }
                });

                // Detect whether this was a purchase enhancement or click conversion
                // by checking which key the payload uses
                const storedPayload = delivery.payload as Record<string, any>;
                const isEnhancement = !!storedPayload.conversionAdjustments;
                const deliveryPayload = isEnhancement
                    ? this.sanitizeEnhancementPayload(storedPayload)
                    : storedPayload;

                await this.sendWithRetry(
                    adAccount.externalId,
                    adAccount as any,
                    deliveryPayload,
                    delivery.id,
                    isEnhancement,
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

        return { attempted: allToRetry.length, recovered };
    }

    /**
     * Send with exponential backoff retry.
     * Uses the adjustment endpoint for enhancements and click uploads for imports.
     */
    private async sendWithRetry(
        customerId: string,
        adAccount: { id: string; accessToken: string; refreshToken: string | null; updatedAt?: Date },
        payload: Record<string, any>,
        deliveryId: string,
        isEnhancement: boolean = true,
    ): Promise<void> {
        const cleanCustomerId = customerId.replace(/-/g, '');
        const action = isEnhancement ? 'uploadConversionAdjustments' : 'uploadClickConversions';
        const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}:${action}`;

        // Fetch credentials from the database/environment
        const creds = await getCredentials('GOOGLE_ADS');
        const developerToken = creds?.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
        const loginCustomerId = creds?.loginCustomerId || process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID || '';

        // Use the shared Google Ads token manager so conversion uploads do not
        // create their own OAuth refresh storm during retries.
        const accessToken = await this.refreshToken(adAccount);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await this.enforcePerCustomerRequestPacing(customerId);

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
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
                        const errMsg = this.normalizeGoogleErrorMessage(parsed.partialFailureError);
                        await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, errMsg);
                        Logger.error('[GoogleEnhanced] Partial failure — conversion rejected by Google', {
                            customerId,
                            partialFailureError: parsed.partialFailureError,
                        });
                        return;
                    }

                    // Log whether Google returned results or an empty array.
                    const resultCount = parsed?.results?.length ?? 0;
                    if (!resultCount) {
                        await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt,
                            'Google returned no conversion result; delivery is unconfirmed. Check the action type, original tag and transaction ID.');
                        return;
                    }
                    const conversionData = payload.conversionAdjustments?.[0] || payload.conversions?.[0];
                    const cartItemCount = conversionData?.cartData?.items?.length ?? 0;
                    Logger.info('[GoogleEnhanced] Conversion uploaded successfully', {
                        customerId, resultCount, isEnhancement, orderId: conversionData?.orderId, cartItemCount,
                    });

                    await this.markDelivery(deliveryId, 'SENT', response.status, responseBody, attempt);
                    return;
                }

                if (response.status === 429 || response.status >= 500) {
                    if (response.status === 429) {
                        const retryAfterMs = this.extractRetryAfterMs(response, responseBody);
                        await this.setQuotaCooldown(customerId, retryAfterMs);
                    }
                    if (attempt < MAX_RETRIES) {
                        await this.backoff(attempt);
                        continue;
                    }
                }

                const lastError = this.isNonRetryableRestError(response.status, responseBody)
                    ? `${NON_RETRYABLE_PREFIX} ${responseBody}`
                    : responseBody;

                await this.markDelivery(deliveryId, 'FAILED', response.status, responseBody, attempt, lastError);
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
     * Refresh the OAuth access token via the shared Google Ads token manager.
     */
    private async refreshToken(
        adAccount: { id: string; accessToken: string; refreshToken: string | null; updatedAt?: Date },
    ): Promise<string> {
        if (!adAccount.refreshToken) return adAccount.accessToken;
        return ensureGoogleAdsAccessToken(adAccount);
    }

    private backoff(attempt: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }

    private googleDateTimeNow(): string {
        return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00:00');
    }

    private normalizeGoogleErrorMessage(error: any): string {
        const rawMessage = error?.message || JSON.stringify(error);
        const serialized = JSON.stringify(error);
        if (this.isNonRetryableGoogleError(serialized)) {
            return `${NON_RETRYABLE_PREFIX} ${rawMessage}`;
        }
        return rawMessage;
    }

    private isNonRetryableRestError(status: number, responseBody: string): boolean {
        return status === 403 && this.isNonRetryableGoogleError(responseBody);
    }

    private isNonRetryableGoogleError(serialized: string): boolean {
        return serialized.includes('INVALID_CONVERSION_ACTION_TYPE')
            || serialized.includes('UNPARSEABLE_GCLID')
            || serialized.toLowerCase().includes('gclid could not be decoded')
            || serialized.includes('USER_PERMISSION_DENIED')
            || serialized.includes('PERMISSION_DENIED');
    }

    private extractRetryAfterMs(response: Response, responseBody: string): number {
        const retryAfterHeader = response.headers.get('retry-after');
        if (retryAfterHeader) {
            const asSeconds = Number(retryAfterHeader);
            if (Number.isFinite(asSeconds) && asSeconds > 0) {
                return asSeconds * 1000;
            }
            const headerDate = Date.parse(retryAfterHeader);
            if (Number.isFinite(headerDate)) {
                const delta = headerDate - Date.now();
                if (delta > 0) return delta;
            }
        }

        const match = responseBody.match(/Retry in\s+(\d+)\s+seconds/i);
        if (match?.[1]) {
            const seconds = Number(match[1]);
            if (Number.isFinite(seconds) && seconds > 0) {
                return seconds * 1000;
            }
        }

        return QUOTA_COOLDOWN_FALLBACK_MS;
    }

    private quotaCooldownRedisKey(customerId: string): string {
        const key = customerId.replace(/-/g, '');
        return `${QUOTA_COOLDOWN_REDIS_PREFIX}:${key}`;
    }

    private requestPacingRedisKey(customerId: string): string {
        const key = customerId.replace(/-/g, '');
        return `${REQUEST_PACING_REDIS_PREFIX}:${key}`;
    }

    private async enforcePerCustomerRequestPacing(customerId: string): Promise<void> {
        if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
            return;
        }

        const key = this.requestPacingRedisKey(customerId);

        try {
            const raw = await redisClient.get(key);
            const nextAllowedAt = raw ? Number(raw) : 0;
            if (Number.isFinite(nextAllowedAt) && nextAllowedAt > Date.now()) {
                const waitMs = Math.max(nextAllowedAt - Date.now(), 1);
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }

            const newNextAllowedAt = Date.now() + REQUEST_PACING_INTERVAL_MS;
            await redisClient.set(
                key,
                String(newNextAllowedAt),
                'PX',
                REQUEST_PACING_INTERVAL_MS * 4,
            );
        } catch (error: any) {
            Logger.warn('[GoogleEnhanced] Request pacing fallback to in-process timing', {
                customerId,
                error: error.message,
            });
            await new Promise((resolve) => setTimeout(resolve, REQUEST_PACING_INTERVAL_MS));
        }
    }

    private async setQuotaCooldown(customerId: string, durationMs: number): Promise<void> {
        const key = customerId.replace(/-/g, '');
        const cooldownUntil = Date.now() + Math.max(durationMs, 1000);
        const current = GoogleEnhancedConversionsService.quotaCooldownUntilMsByCustomer.get(key) || 0;
        if (cooldownUntil > current) {
            GoogleEnhancedConversionsService.quotaCooldownUntilMsByCustomer.set(key, cooldownUntil);
            try {
                const ttlMs = Math.max(cooldownUntil - Date.now(), 1000);
                await redisClient.set(this.quotaCooldownRedisKey(customerId), String(cooldownUntil), 'PX', ttlMs);
            } catch (error: any) {
                Logger.warn('[GoogleEnhanced] Failed to persist quota cooldown to Redis', {
                    customerId,
                    error: error.message,
                });
            }
            Logger.warn('[GoogleEnhanced] Quota cooldown activated', {
                customerId,
                retryAt: new Date(cooldownUntil).toISOString(),
                durationSec: Math.round(durationMs / 1000),
            });
        }
    }

    private getInMemoryQuotaCooldownUntil(customerId: string): number {
        const key = customerId.replace(/-/g, '');
        return GoogleEnhancedConversionsService.quotaCooldownUntilMsByCustomer.get(key) || 0;
    }

    private async getActiveQuotaCooldownUntil(customerId: string): Promise<number> {
        const normalized = customerId.replace(/-/g, '');
        const inMemoryCooldownUntil = this.getInMemoryQuotaCooldownUntil(customerId);
        if (inMemoryCooldownUntil > Date.now()) {
            return inMemoryCooldownUntil;
        }

        if (inMemoryCooldownUntil) {
            GoogleEnhancedConversionsService.quotaCooldownUntilMsByCustomer.delete(normalized);
        }

        try {
            const raw = await redisClient.get(this.quotaCooldownRedisKey(customerId));
            const redisCooldownUntil = raw ? Number(raw) : 0;

            if (!Number.isFinite(redisCooldownUntil) || redisCooldownUntil <= 0) {
                return 0;
            }

            if (redisCooldownUntil <= Date.now()) {
                await redisClient.del(this.quotaCooldownRedisKey(customerId));
                return 0;
            }

            GoogleEnhancedConversionsService.quotaCooldownUntilMsByCustomer.set(normalized, redisCooldownUntil);
            return redisCooldownUntil;
        } catch (error: any) {
            Logger.warn('[GoogleEnhanced] Failed to read quota cooldown from Redis', {
                customerId,
                error: error.message,
            });
            return 0;
        }
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
