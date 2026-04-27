/**
 * Conversion Forwarder — Central Orchestrator
 *
 * Sits between EventProcessor and platform-specific CAPI services.
 * Checks which platforms are enabled for an account, then fans out
 * conversion events to all enabled platforms in parallel.
 *
 * Why fire-and-forget: CAPI delivery is best-effort. A Meta API outage
 * must never cause an OverSeek tracking failure. All errors are logged
 * to ConversionDelivery for retry/debugging.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { isConversionEvent } from './conversionUtils';
import { randomUUID } from 'crypto';

import type { TrackingEventPayload } from './EventProcessor';

/** Platform service interface — each CAPI service implements this */
export interface ConversionPlatformService {
    /** Platform identifier: META, TIKTOK, GOOGLE, PINTEREST, GA4, SNAPCHAT, MICROSOFT, TWITTER */
    readonly platform: string;
    /**
     * Send a conversion event to this platform.
     * Must handle its own error logging and ConversionDelivery writes.
     */
    sendEvent(
        accountId: string,
        config: Record<string, any>,
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void>;
}

/** Cached platform config entry */
interface CachedConfig {
    configs: Array<{ platform: string; config: Record<string, any> }>;
    createdAt: number;
}

/** TTL for cached config lookups (5 minutes) */
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

/** In-memory cache: accountId → enabled platform configs */
const configCache = new Map<string, CachedConfig>();

/** Registry of platform services — populated at startup via register() */
const platformServices = new Map<string, ConversionPlatformService>();

export class ConversionForwarder {
    /**
     * Check whether an event type is enabled for a specific platform config.
     * If no events object is configured, default to enabled for backward compatibility.
     */
    private static isEventEnabledForPlatform(config: Record<string, any>, eventType: string): boolean {
        const events = config?.events;
        if (!events || typeof events !== 'object') return true;

        const EVENT_TOGGLE_MAP: Record<string, string> = {
            purchase: 'purchase',
            add_to_cart: 'addToCart',
            checkout_start: 'initiateCheckout',
            product_view: 'viewContent',
            search: 'search',
        };

        const toggleKey = EVENT_TOGGLE_MAP[eventType];
        if (!toggleKey) return true;

        // Toggle defaults to enabled unless explicitly set to false
        return events[toggleKey] !== false;
    }

    /**
     * Register a platform service. Called once at app startup
     * for each supported platform.
     */
    static register(service: ConversionPlatformService): void {
        platformServices.set(service.platform, service);
        Logger.debug(`[ConversionForwarder] Registered platform: ${service.platform}`);
    }

    /**
     * Invalidate cached config for an account.
     * Called by the CAPI settings route after config changes.
     */
    static invalidateCache(accountId: string): void {
        configCache.delete(accountId);
    }

    /**
     * Main entry point — called from EventProcessor after event persistence.
     * Checks if the event is a conversion type, then forwards to all enabled platforms.
     *
     * This method NEVER throws. All errors are caught and logged.
     */
    static async forwardIfConversion(
        data: TrackingEventPayload,
        session: { id: string; email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    ): Promise<void> {
        try {
            if (!isConversionEvent(data.type)) return;

            // Generate fallback eventId if plugin didn't provide one (old plugin versions)
            if (!data.eventId) {
                data.eventId = randomUUID();
                Logger.warn('[ConversionForwarder] eventId missing from plugin — browser pixel dedup disabled', {
                    type: data.type,
                    accountId: data.accountId,
                });
            }

            const enabledConfigs = await ConversionForwarder.getEnabledPlatforms(data.accountId);
            if (enabledConfigs.length === 0) return;

            const filteredConfigs = enabledConfigs.filter(({ config }) =>
                ConversionForwarder.isEventEnabledForPlatform(config, data.type),
            );
            if (filteredConfigs.length === 0) return;

            // Fan out to all enabled platforms — allSettled ensures one failure doesn't block others
            const results = await Promise.allSettled(
                filteredConfigs.map(({ platform, config }) => {
                    const service = platformServices.get(platform);
                    if (!service) {
                        Logger.warn(`[ConversionForwarder] No service registered for platform: ${platform}`);
                        return Promise.resolve();
                    }
                    return service.sendEvent(data.accountId, config, data, session);
                }),
            );

            // Log any rejected promises for visibility
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (result.status === 'rejected') {
                    Logger.error('[ConversionForwarder] Platform delivery failed', {
                        platform: filteredConfigs[i].platform,
                        accountId: data.accountId,
                        eventType: data.type,
                        error: result.reason?.message || String(result.reason),
                    });
                }
            }
        } catch (error: any) {
            // Outermost safety net — this should never propagate to EventProcessor
            Logger.error('[ConversionForwarder] Unexpected error in forwardIfConversion', {
                accountId: data.accountId,
                eventType: data.type,
                error: error.message,
            });
        }
    }

    /**
     * Look up which CAPI platforms are enabled for an account.
     * Uses an in-memory cache with 5-minute TTL to avoid DB queries per event.
     */
    private static async getEnabledPlatforms(
        accountId: string,
    ): Promise<Array<{ platform: string; config: Record<string, any> }>> {
        const now = Date.now();
        const cached = configCache.get(accountId);

        if (cached && now - cached.createdAt < CONFIG_CACHE_TTL_MS) {
            return cached.configs;
        }

        // Feature keys that correspond to CAPI platforms
        const capiFeatureKeys = [
            'META_CAPI',
            'TIKTOK_EVENTS_API',
            'GOOGLE_ENHANCED_CONVERSIONS',
            'PINTEREST_CAPI',
            'GA4_MEASUREMENT',
            'SNAPCHAT_CAPI',
            'MICROSOFT_CAPI',
            'TWITTER_CAPI',
        ];

        /** Maps AccountFeature.featureKey → ConversionPlatformService.platform */
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

        try {
            const features = await prisma.accountFeature.findMany({
                where: {
                    accountId,
                    featureKey: { in: capiFeatureKeys },
                    isEnabled: true,
                },
                select: {
                    featureKey: true,
                    config: true,
                },
            });

            const configs = features
                .filter((f) => f.config && typeof f.config === 'object')
                .map((f) => ({
                    platform: featureKeyToPlatform[f.featureKey] || f.featureKey,
                    config: f.config as Record<string, any>,
                }));

            configCache.set(accountId, { configs, createdAt: now });
            return configs;
        } catch (error: any) {
            Logger.error('[ConversionForwarder] Failed to fetch platform configs', {
                accountId,
                error: error.message,
            });
            return [];
        }
    }
}
