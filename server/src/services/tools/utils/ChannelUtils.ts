/**
 * Channel Normalization Utilities
 * 
 * Shared utilities for normalizing traffic sources to canonical channel names.
 * Used by CrossChannelAnalyzer, LTVAnalyzer, and other attribution-related code.
 */

// Standard channel names
export type NormalizedChannel =
    | 'google'
    | 'meta'
    | 'organic_search'
    | 'email'
    | 'direct'
    | 'social_organic'
    | 'other';

/**
 * Normalize a traffic source string to a canonical channel name.
 * Handles various formats from UTM parameters, ad platforms, etc.
 */
export function normalizeChannel(source: string | null | undefined): NormalizedChannel {
    if (!source) return 'direct';

    const s = source.toLowerCase().trim();

    // Google sources
    if (s.includes('google') || s.includes('gclid') || s === 'cpc' || s === 'google-ads') {
        return 'google';
    }

    // Meta sources (Facebook, Instagram)
    if (
        s.includes('facebook') ||
        s.includes('instagram') ||
        s.includes('fb') ||
        s.includes('meta') ||
        s.includes('fbclid') ||
        s === 'ig'
    ) {
        return 'meta';
    }

    // Organic search
    if (
        s.includes('organic') ||
        s === 'bing' ||
        s === 'yahoo' ||
        s === 'duckduckgo' ||
        s === 'baidu' ||
        s === 'yandex'
    ) {
        return 'organic_search';
    }

    // Email
    if (
        s.includes('email') ||
        s.includes('newsletter') ||
        s.includes('klaviyo') ||
        s.includes('mailchimp') ||
        s.includes('sendgrid') ||
        s.includes('drip')
    ) {
        return 'email';
    }

    // Direct
    if (s === 'direct' || s === '(direct)' || s === 'none' || s === '' || s === '(none)') {
        return 'direct';
    }

    // Social organic (non-paid)
    if (s.includes('social') || s.includes('twitter') || s.includes('linkedin') || s.includes('tiktok')) {
        return 'social_organic';
    }

    return 'other';
}

/**
 * Check if a channel is a paid advertising channel.
 */
export function isPaidChannel(channel: NormalizedChannel): boolean {
    return channel === 'google' || channel === 'meta';
}

/**
 * Get display name for a channel.
 */
export function getChannelDisplayName(channel: NormalizedChannel): string {
    switch (channel) {
        case 'google': return 'Google Ads';
        case 'meta': return 'Meta Ads';
        case 'organic_search': return 'Organic Search';
        case 'email': return 'Email';
        case 'direct': return 'Direct';
        case 'social_organic': return 'Social (Organic)';
        case 'other': return 'Other';
    }
}
