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
    | 'paid_other'
    | 'organic_search'
    | 'email'
    | 'direct'
    | 'social_organic'
    | 'other';

/**
 * Normalize a traffic source string to a canonical channel name.
 * Handles various formats from UTM parameters, ad platforms, etc.
 */
export function normalizeChannel(source: string | null | undefined, medium?: string | null): NormalizedChannel {
    if (typeof source !== 'string' || !source.trim()) return 'direct';
    const s = source.toLowerCase().trim();
    if (['direct', '(direct)', 'none', '(none)'].includes(s)) return 'direct';
    let url: URL | undefined;
    try { url = new URL(s.includes('://') ? s : `https://${s}`); } catch { /* A source can be a label, not a URL. */ }
    const isUrl = s.includes('://') || /^[^\s/?]+\.[^\s/]+/.test(s);
    const label = isUrl && url ? url.searchParams.get('utm_source') || url.hostname : s;
    const tokens = new Set(label.match(/[\p{L}\p{N}]+/gu) || []);
    const has = (...words: string[]) => words.some(word => tokens.has(word));
    const host = url?.hostname || '';
    const domain = (name: string) => host === name || host.endsWith(`.${name}`);
    const google = has('google');
    const meta = has('facebook', 'instagram', 'meta', 'fb', 'ig', 'fbclid');
    const social = meta || has('social', 'twitter', 'linkedin', 'tiktok', 'pinterest') || domain('x.com') || domain('t.co');
    const campaignMedium = (typeof medium === 'string' ? medium : url?.searchParams.get('utm_medium') || '').trim().toLowerCase();
    const clickId = Boolean(url?.searchParams.get('gclid')?.trim()) || s === 'gclid';
    const explicitPaid = has('ads', 'adwords') || clickId;
    if (google && explicitPaid || clickId) return 'google';
    if (meta && has('ads')) return 'meta';
    if (has('email', 'newsletter', 'klaviyo', 'mailchimp', 'sendgrid', 'drip') || campaignMedium === 'email' || domain('mail.google.com')) return 'email';
    if (has('organic') || campaignMedium === 'organic') return social ? 'social_organic' : 'organic_search';
    const paid = has('cpc', 'ppc', 'paid') || /^(?:cpc|ppc|paid|paid[_ -]?(?:social|search))$/.test(campaignMedium);
    if (paid) return google ? 'google' : meta ? 'meta' : 'paid_other';
    if (['bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com', 'yandex.com'].some(domain) ||
        /^(?:www\.)?google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/.test(host) || ['bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex'].includes(s)) return 'organic_search';
    if (social) return 'social_organic';
    // An unqualified "google" label identifies a provider, not whether the traffic was paid.
    return 'other';
}

/**
 * Check if a channel is a paid advertising channel.
 */
export function isPaidChannel(channel: NormalizedChannel): boolean {
    return channel === 'google' || channel === 'meta' || channel === 'paid_other';
}

/**
 * Get display name for a channel.
 */
export function getChannelDisplayName(channel: NormalizedChannel): string {
    switch (channel) {
        case 'google': return 'Google Ads';
        case 'meta': return 'Meta Ads';
        case 'paid_other': return 'Paid (provider unknown or unsupported)';
        case 'organic_search': return 'Organic Search';
        case 'email': return 'Email';
        case 'direct': return 'Direct';
        case 'social_organic': return 'Social (Organic)';
        case 'other': return 'Other';
    }
}
