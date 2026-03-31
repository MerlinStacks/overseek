/**
 * Conversion Tracking Utilities
 *
 * Shared helpers for server-side conversion event forwarding.
 * Used by all platform services (Meta, TikTok, Google, Pinterest, GA4, Snapchat, Microsoft, Twitter/X).
 *
 * Why this exists: Centralises PII hashing, event mapping, and user data
 * extraction so each platform service only handles API-specific formatting.
 */

import { createHash } from 'crypto';

/** Event types that should be forwarded to ad platforms */
const CONVERSION_EVENT_TYPES = new Set([
    'purchase',
    'add_to_cart',
    'checkout_start',
    'product_view',
    'search',
]);

/** Maps OverSeek event types to platform-specific event names */
const EVENT_NAME_MAP: Record<string, Record<string, string>> = {
    META: {
        purchase: 'Purchase',
        add_to_cart: 'AddToCart',
        checkout_start: 'InitiateCheckout',
        product_view: 'ViewContent',
        search: 'Search',
    },
    TIKTOK: {
        purchase: 'CompletePayment',
        add_to_cart: 'AddToCart',
        checkout_start: 'InitiateCheckout',
        product_view: 'ViewContent',
        search: 'Search',
    },
    GOOGLE: {
        purchase: 'purchase',
        add_to_cart: 'add_to_cart',
        checkout_start: 'begin_checkout',
        product_view: 'view_item',
    },
    PINTEREST: {
        purchase: 'checkout',
        add_to_cart: 'add_to_cart',
        product_view: 'page_visit',
        search: 'search',
    },
    GA4: {
        purchase: 'purchase',
        add_to_cart: 'add_to_cart',
        checkout_start: 'begin_checkout',
        product_view: 'view_item',
        search: 'search',
    },
    SNAPCHAT: {
        purchase: 'PURCHASE',
        add_to_cart: 'ADD_CART',
        checkout_start: 'START_CHECKOUT',
        product_view: 'VIEW_CONTENT',
        search: 'SEARCH',
    },
    MICROSOFT: {
        purchase: 'purchase',
        add_to_cart: 'add_to_cart',
        checkout_start: 'begin_checkout',
        product_view: 'page_view',
        search: 'search',
    },
    TWITTER: {
        purchase: 'Purchase',
        add_to_cart: 'AddToCart',
        checkout_start: 'InitiateCheckout',
        product_view: 'ViewContent',
        search: 'Search',
    },
};

/** User data extracted from event payload and session for PII matching */
export interface ConversionUserData {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    ipAddress?: string;
    userAgent?: string;
    /** Meta _fbc cookie */
    fbc?: string;
    /** Meta _fbp cookie */
    fbp?: string;
    /** TikTok _ttp cookie */
    ttp?: string;
    /** Pinterest _epq cookie */
    epq?: string;
    /** GA4 client ID from _ga cookie */
    gaClientId?: string;
    /** Ad platform click ID (gclid, fbclid, ttclid, etc.) */
    clickId?: string;
    /** Which platform the click ID belongs to */
    clickPlatform?: string;
    /** Snapchat _scid cookie */
    sclid?: string;
    /** Microsoft Ads msclkid */
    msclkid?: string;
    /** Twitter/X twclid */
    twclid?: string;
}

/**
 * SHA-256 hash a value after lowercasing and trimming.
 * All ad platforms require PII to be hashed this way.
 *
 * @returns Hex-encoded SHA-256 hash, or undefined if input is falsy
 */
export function hashSHA256(value: string | undefined | null): string | undefined {
    if (!value || !value.trim()) return undefined;
    const normalised = value.trim().toLowerCase();
    return createHash('sha256').update(normalised).digest('hex');
}

/**
 * Check if an event type should be forwarded to ad platforms.
 */
export function isConversionEvent(type: string): boolean {
    return CONVERSION_EVENT_TYPES.has(type);
}

/**
 * Map an OverSeek event type to a platform-specific event name.
 *
 * @returns Platform event name, or undefined if the platform doesn't support this event type
 */
export function mapEventName(type: string, platform: string): string | undefined {
    return EVENT_NAME_MAP[platform]?.[type];
}

/**
 * Extract user data from event payload and session for PII matching.
 * Merges data from both sources — payload takes precedence (fresher data).
 *
 * @param rawIpAddress - Unmasked IP from the original request. Session IP is
 *   privacy-masked (last octet replaced with 'xxx') which ad platforms reject.
 */
export function extractUserData(
    payload: Record<string, any> | undefined,
    session: { email?: string | null; ipAddress?: string | null; userAgent?: string | null; country?: string | null } | null,
    rawIpAddress?: string,
): ConversionUserData {
    const p = payload || {};
    return {
        email: p.email || session?.email || undefined,
        phone: p.billingPhone || p.phone || undefined,
        firstName: p.billingFirst || p.firstName || undefined,
        lastName: p.billingLast || p.lastName || undefined,
        city: p.billingCity || p.city || undefined,
        state: p.billingState || p.state || undefined,
        zip: p.billingZip || p.zip || undefined,
        country: p.billingCountry || session?.country || undefined,
        // Prefer raw (unmasked) IP for CAPI; fall back to session IP only if raw unavailable
        ipAddress: rawIpAddress || session?.ipAddress || undefined,
        userAgent: session?.userAgent || undefined,
        fbc: p.fbc || undefined,
        fbp: p.fbp || undefined,
        ttp: p.ttp || undefined,
        epq: p.epq || undefined,
        gaClientId: p.gaClientId || undefined,
        clickId: p.clickId || undefined,
        clickPlatform: p.clickPlatform || undefined,
        sclid: p.sclid || undefined,
        msclkid: p.msclkid || undefined,
        twclid: p.twclid || undefined,
    };
}

/**
 * Get the list of all supported platform identifiers.
 */
export function getSupportedPlatforms(): string[] {
    return ['META', 'TIKTOK', 'GOOGLE', 'PINTEREST', 'GA4', 'SNAPCHAT', 'MICROSOFT', 'TWITTER'];
}
