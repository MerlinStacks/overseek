import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { WooService } from './woo';
import * as CrawlerService from './tracking/CrawlerService';

type StorefrontConfigScope = 'chat' | 'pixels' | 'botShield';

const PLATFORM_FEATURE_KEY: Record<string, string> = {
    meta: 'META_CAPI',
    tiktok: 'TIKTOK_EVENTS_API',
    google: 'GOOGLE_ENHANCED_CONVERSIONS',
    pinterest: 'PINTEREST_CAPI',
    ga4: 'GA4_MEASUREMENT',
    snapchat: 'SNAPCHAT_CAPI',
    microsoft: 'MICROSOFT_CAPI',
    twitter: 'TWITTER_CAPI',
    _consent: 'CONSENT_MODE',
};

const SAFE_PIXEL_FIELDS: Record<string, string[]> = {
    META_CAPI: ['pixelId', 'events', 'advancedMatching', 'contentIdFormat', 'contentIdPrefix', 'contentIdSuffix', 'excludeShipping', 'excludeTax'],
    TIKTOK_EVENTS_API: ['pixelCode', 'events', 'advancedMatching'],
    GA4_MEASUREMENT: ['measurementId', 'events'],
    GOOGLE_ENHANCED_CONVERSIONS: ['conversionId', 'conversionLabel', 'conversionLabelPurchase', 'conversionLabelAddToCart', 'conversionLabelBeginCheckout', 'conversionLabelViewItem', 'merchantId', 'feedCountry', 'feedLanguage', 'events'],
    PINTEREST_CAPI: ['tagId', 'events'],
    SNAPCHAT_CAPI: ['pixelId', 'events'],
    MICROSOFT_CAPI: ['tagId', 'events'],
    TWITTER_CAPI: ['pixelId', 'events'],
    CONSENT_MODE: ['autoAccept'],
};

export async function syncStorefrontConfigToWoo(accountId: string, scopes: StorefrontConfigScope[] = ['chat', 'pixels', 'botShield']): Promise<void> {
    if (!accountId) return;

    try {
        const payload: Record<string, any> = { account_id: accountId };

        if (scopes.includes('chat')) {
            payload.chat = await buildChatConfig(accountId);
        }

        if (scopes.includes('pixels')) {
            payload.pixels = await buildPixelConfig(accountId);
        }

        if (scopes.includes('botShield')) {
            payload.botShield = await buildBotShieldConfig(accountId);
        }

        const woo = await WooService.forAccount(accountId);
        await woo.updateStorefrontConfig(payload);
    } catch (error) {
        Logger.warn('[StorefrontConfigSync] Failed to push storefront config to WooCommerce', {
            accountId,
            scopes,
            error: error instanceof Error ? error.message : error,
        });
    }
}

async function buildChatConfig(accountId: string): Promise<Record<string, any>> {
    const feature = await prisma.accountFeature.findUnique({
        where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } },
        select: { config: true },
    });

    const config = (feature?.config as Record<string, any>) || {};
    return {
        businessHours: config.businessHours || { enabled: false },
        businessTimezone: config.businessTimezone || 'Australia/Sydney',
        position: config.position || 'bottom-right',
        showOnMobile: config.showOnMobile !== false,
    };
}

async function buildPixelConfig(accountId: string): Promise<Record<string, any>> {
    const features = await prisma.accountFeature.findMany({
        where: {
            accountId,
            featureKey: { in: Object.values(PLATFORM_FEATURE_KEY) },
        },
        select: { featureKey: true, isEnabled: true, config: true },
    });

    const featuresByKey = new Map(features.map((feature) => [feature.featureKey, feature]));
    const pixels: Record<string, any> = {};

    for (const [urlKey, featureKey] of Object.entries(PLATFORM_FEATURE_KEY)) {
        const feature = featuresByKey.get(featureKey);

        if (urlKey === '_consent') {
            if (feature) {
                const raw = (feature.config as Record<string, any>) || {};
                pixels._consent = { autoAccept: !!raw.autoAccept };
            }
            continue;
        }

        if (!feature?.isEnabled) continue;

        const raw = (feature.config as Record<string, any>) || {};
        const allowed = SAFE_PIXEL_FIELDS[featureKey] || [];
        const safeConfig: Record<string, any> = {};
        for (const key of allowed) {
            if (raw[key] !== undefined) safeConfig[key] = raw[key];
        }
        pixels[urlKey] = safeConfig;
    }

    return pixels;
}

async function buildBotShieldConfig(accountId: string): Promise<Record<string, any>> {
    const enabled = await isBotShieldEnabled(accountId);
    if (!enabled) {
        return { patterns: [], blockPageHtml: null };
    }

    const [patterns, blockPageHtml] = await Promise.all([
        CrawlerService.getBlockedPatterns(accountId),
        CrawlerService.getBlockPageHtml(accountId),
    ]);

    return { patterns, blockPageHtml };
}

async function isBotShieldEnabled(accountId: string): Promise<boolean> {
    const feature = await prisma.accountFeature.findUnique({
        where: { accountId_featureKey: { accountId, featureKey: 'BOT_SHIELD' } },
        select: { isEnabled: true },
    });

    return feature ? feature.isEnabled : true;
}
