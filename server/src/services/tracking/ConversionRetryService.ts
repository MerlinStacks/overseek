/**
 * Conversion Retry Service
 *
 * Automatically retries FAILED ConversionDelivery records for all CAPI platforms.
 * Runs as a background scheduler task every 10 minutes.
 *
 * Why this exists: The ConversionForwarder uses fire-and-forget delivery.
 * Transient network errors, rate limits (429), or platform outages can cause
 * events to fail. Without retry, these conversions are permanently lost,
 * leading to under-reporting in ad platforms.
 *
 * Strategy by platform:
 * - GOOGLE: Delegates to GoogleEnhancedConversionsService.retryFailedDeliveries
 *           which handles OAuth refresh and payload reconstruction.
 * - GA4, META, TIKTOK, PINTEREST, SNAPCHAT, MICROSOFT, TWITTER:
 *   Reconstructs a minimal TrackingEventPayload from the stored delivery
 *   and re-invokes the platform service. Match quality may be lower than
 *   the original attempt since session context is not persisted.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

const BATCH_SIZE = 100;
const MAX_AGE_HOURS = 24; // Don't retry failures older than 24 hours

/**
 * Find and retry all failed conversion deliveries across all accounts.
 * Called by the MaintenanceScheduler every 10 minutes.
 */
export async function retryFailedConversions(): Promise<{
    totalAttempted: number;
    totalRecovered: number;
    platformBreakdown: Record<string, { attempted: number; recovered: number }>;
}> {
    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);

    const failedDeliveries = await prisma.conversionDelivery.findMany({
        where: {
            status: 'FAILED',
            createdAt: { gte: cutoff },
            attempts: { lt: 5 }, // Only retry up to 5 total attempts
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        select: {
            id: true,
            accountId: true,
            platform: true,
            eventName: true,
            eventId: true,
            payload: true,
            attempts: true,
            lastError: true,
            createdAt: true,
        },
    });

    if (failedDeliveries.length === 0) {
        return { totalAttempted: 0, totalRecovered: 0, platformBreakdown: {} };
    }

    Logger.info(
        `[ConversionRetry] Found ${failedDeliveries.length} failed deliveries to retry`,
        { platforms: [...new Set(failedDeliveries.map(d => d.platform))] }
    );

    let totalAttempted = 0;
    let totalRecovered = 0;
    const platformBreakdown: Record<string, { attempted: number; recovered: number }> = {};

    const platformGroups = groupBy(failedDeliveries, 'platform');

    for (const [platform, deliveries] of Object.entries(platformGroups)) {
        let attempted = 0;
        let recovered = 0;

        // Google retry path is account-scoped and already bulk-processes deliveries.
        // Running it once per failed row causes repeated replays and request bursts.
        if (platform === 'GOOGLE') {
            const accountIds = [...new Set(deliveries.map(d => d.accountId))];

            for (const accountId of accountIds) {
                try {
                    const { GoogleEnhancedConversionsService } = await import('./GoogleEnhancedConversionsService');
                    const service = new GoogleEnhancedConversionsService();
                    const result = await service.retryFailedDeliveries(accountId, MAX_AGE_HOURS);
                    attempted += result.attempted;
                    recovered += result.recovered;
                } catch (error: any) {
                    Logger.error(`[ConversionRetry] Google retry failed for account ${accountId}`, {
                        accountId,
                        error: error.message,
                    });
                }
            }

            platformBreakdown[platform] = { attempted, recovered };
            totalAttempted += attempted;
            totalRecovered += recovered;
            continue;
        }

        for (const delivery of deliveries) {
            attempted++;
            try {
                const success = await retryDelivery(delivery);
                if (success) recovered++;
            } catch (error: any) {
                Logger.error(`[ConversionRetry] Retry failed for ${delivery.id}`, {
                    platform,
                    error: error.message,
                });
            }
        }

        platformBreakdown[platform] = { attempted, recovered };
        totalAttempted += attempted;
        totalRecovered += recovered;
    }

    Logger.info(`[ConversionRetry] Retry batch complete`, {
        totalAttempted,
        totalRecovered,
        platformBreakdown,
    });

    return { totalAttempted, totalRecovered, platformBreakdown };
}

/**
 * Retry a single failed delivery.
 */
async function retryDelivery(
    delivery: {
        id: string;
        accountId: string;
        platform: string;
        eventName: string;
        eventId: string;
        payload: any;
        attempts: number;
    },
): Promise<boolean> {
    // Find the platform config from AccountFeature
    const config = await getPlatformConfig(delivery.accountId, delivery.platform);
    if (!config) {
        Logger.warn(`[ConversionRetry] No config for ${delivery.platform}`, { accountId: delivery.accountId });
        return false;
    }

    // Reconstruct a minimal event payload from the stored delivery
    const trackingPayload = buildTrackingPayloadFromDelivery(delivery);

    // Update to PENDING before attempting
    await prisma.conversionDelivery.update({
        where: { id: delivery.id },
        data: { status: 'PENDING', attempts: { increment: 1 } },
    });

    try {
        await sendToPlatform(delivery.platform, delivery.accountId, config, trackingPayload);

        // Check the new status
        const updated = await prisma.conversionDelivery.findUnique({
            where: { id: delivery.id },
            select: { status: true },
        });

        return updated?.status === 'SENT';
    } catch {
        return false;
    }
}

/**
 * Get platform config from AccountFeature.
 */
async function getPlatformConfig(accountId: string, platform: string): Promise<Record<string, any> | null> {
    const featureKeyToPlatform: Record<string, string> = {
        META_CAPI: 'META',
        TIKTOK_EVENTS_API: 'TIKTOK',
        GOOGLE_ENHANCED_CONVERSIONS: 'GOOGLE',
        PINTEREST_CAPI: 'PINTEREST',
        GA4_MEASUREMENT: 'GA4',
        SNAPCHAT_CAPI: 'SNAPCHAT',
        MICROSOFT_CAPI: 'MICROSOFT',
        TWITTER_CAPI: 'TWITTER',
    };

    const platformToFeatureKey = Object.fromEntries(
        Object.entries(featureKeyToPlatform).map(([k, v]) => [v, k])
    );

    const featureKey = platformToFeatureKey[platform];
    if (!featureKey) return null;

    const feature = await prisma.accountFeature.findUnique({
        where: { accountId_featureKey: { accountId, featureKey } },
        select: { config: true, isEnabled: true },
    });

    if (!feature?.isEnabled || !feature.config || typeof feature.config !== 'object') {
        return null;
    }

    return feature.config as Record<string, any>;
}

/**
 * Send a reconstructed event to a platform service by dynamic import/instantiation.
 */
async function sendToPlatform(
    platform: string,
    accountId: string,
    config: Record<string, any>,
    data: any,
): Promise<void> {
    switch (platform) {
        case 'GA4': {
            const { GA4MeasurementService } = await import('./GA4MeasurementService');
            const service = new GA4MeasurementService();
            await service.sendEvent(accountId, config, data, null);
            break;
        }
        case 'META': {
            const { MetaCAPIService } = await import('./MetaCAPIService');
            const service = new MetaCAPIService();
            await service.sendEvent(accountId, config, data, null);
            break;
        }
        case 'TIKTOK': {
            const { TikTokEventsService } = await import('./TikTokEventsService');
            const service = new TikTokEventsService();
            await service.sendEvent(accountId, config, data, null);
            break;
        }
        case 'PINTEREST': {
            const { PinterestCAPIService } = await import('./PinterestCAPIService');
            const service = new PinterestCAPIService();
            await service.sendEvent(accountId, config, data, null);
            break;
        }
        case 'SNAPCHAT': {
            const { SnapchatCAPIService } = await import('./SnapchatCAPIService');
            const service = new SnapchatCAPIService();
            await service.sendEvent(accountId, config, data, null);
            break;
        }
        case 'MICROSOFT': {
            const { MicrosoftCAPIService } = await import('./MicrosoftCAPIService');
            const service = new MicrosoftCAPIService();
            await service.sendEvent(accountId, config, data, null);
            break;
        }
        case 'TWITTER': {
            const { TwitterCAPIService } = await import('./TwitterCAPIService');
            const service = new TwitterCAPIService();
            await service.sendEvent(accountId, config, data, null);
            break;
        }
        default:
            throw new Error(`Unknown platform: ${platform}`);
    }
}

/**
 * Rebuild a TrackingEventPayload from a stored ConversionDelivery record.
 *
 * The stored payload is platform-specific (e.g., GA4 has `{ client_id, events, ... }`).
 * We extract the original event data from the stored params so the platform service
 * can rebuild its own API payload.
 */
function buildTrackingPayloadFromDelivery(delivery: {
    payload: any;
    eventId: string;
    accountId: string;
    platform: string;
}): any {
    const storedPayload = (delivery.payload || {}) as Record<string, any>;

    // For each platform, the stored payload shape is different.
    // Extract the original event data that was passed to the service.

    let eventParams: Record<string, any> = {};

    if (delivery.platform === 'GA4') {
        eventParams = storedPayload.events?.[0]?.params || {};
    } else if (delivery.platform === 'META') {
        eventParams = storedPayload.data?.[0]?.custom_data || {};
    } else if (delivery.platform === 'TIKTOK') {
        eventParams = storedPayload.properties || {};
    } else {
        // Fallback: use the entire stored payload as event params
        eventParams = storedPayload;
    }

    return {
        accountId: delivery.accountId,
        visitorId: storedPayload.client_id || 'retry-unknown',
        type: reverseMapEventName(delivery.platform, storedPayload),
        url: eventParams.page_location || eventParams.content_url || 'https://unknown',
        eventId: delivery.eventId,
        payload: {
            orderId: eventParams.transaction_id,
            total: eventParams.value,
            currency: eventParams.currency,
            tax: eventParams.tax,
            shipping: eventParams.shipping,
            items: eventParams.items,
            customerId: storedPayload.user_id,
        },
    };
}

/**
 * Reverse-map a stored platform payload back to an internal event type.
 */
function reverseMapEventName(platform: string, storedPayload: Record<string, any>): string {
    const EVENT_NAME_MAP: Record<string, Record<string, string>> = {
        META: {
            Purchase: 'purchase',
            AddToCart: 'add_to_cart',
            InitiateCheckout: 'checkout_start',
            ViewContent: 'product_view',
            Search: 'search',
        },
        TIKTOK: {
            CompletePayment: 'purchase',
            AddToCart: 'add_to_cart',
            InitiateCheckout: 'checkout_start',
            ViewContent: 'product_view',
            Search: 'search',
        },
        GA4: {
            purchase: 'purchase',
            add_to_cart: 'add_to_cart',
            begin_checkout: 'checkout_start',
            view_item: 'product_view',
            search: 'search',
        },
        PINTEREST: {
            checkout: 'purchase',
            add_to_cart: 'add_to_cart',
            page_visit: 'product_view',
            search: 'search',
        },
        SNAPCHAT: {
            PURCHASE: 'purchase',
            ADD_CART: 'add_to_cart',
            START_CHECKOUT: 'checkout_start',
            VIEW_CONTENT: 'product_view',
            SEARCH: 'search',
        },
        MICROSOFT: {
            purchase: 'purchase',
            add_to_cart: 'add_to_cart',
            begin_checkout: 'checkout_start',
            page_view: 'product_view',
            search: 'search',
        },
        TWITTER: {
            Purchase: 'purchase',
            AddToCart: 'add_to_cart',
            InitiateCheckout: 'checkout_start',
            ViewContent: 'product_view',
            Search: 'search',
        },
        GOOGLE: {
            purchase: 'purchase',
            add_to_cart: 'add_to_cart',
            begin_checkout: 'checkout_start',
            view_item: 'product_view',
        },
    };

    let eventName = '';
    if (platform === 'GA4') {
        eventName = storedPayload.events?.[0]?.name || '';
    } else if (platform === 'META') {
        eventName = storedPayload.data?.[0]?.event_name || '';
    } else if (platform === 'TIKTOK') {
        eventName = storedPayload.event || '';
    } else {
        // Fallback: can't determine — default to purchase
        return 'purchase';
    }

    const map = EVENT_NAME_MAP[platform] || {};
    const direct = map[eventName];
    if (direct) return direct;

    // Case-insensitive fallback
    const lower = eventName.toLowerCase();
    for (const [key, value] of Object.entries(map)) {
        if (key.toLowerCase() === lower) return value;
    }

    return 'purchase';
}

/**
 * Group an array of objects by a key value.
 */
function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((result, item) => {
        const groupKey = String(item[key]);
        result[groupKey] = result[groupKey] || [];
        result[groupKey].push(item);
        return result;
    }, {} as Record<string, T[]>);
}
